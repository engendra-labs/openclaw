import path from "node:path";
import type { FsRoot } from "../config/types.tools.js";
import { assertNoPathAliasEscape, PATH_ALIAS_POLICIES } from "../infra/path-alias-guards.js";
import { isPathInside } from "../infra/path-guards.js";
import { normalizeToolParams } from "./pi-tools.params.js";
import { resolveToolPathAgainstWorkspaceRoot } from "./pi-tools.read.js";
import type { AnyAgentTool } from "./pi-tools.types.js";

export type FsRootResolved = FsRoot & { resolvedPath: string };

export function resolveRoots(roots: FsRoot[]): FsRootResolved[] {
  return roots.map((r) => ({ ...r, resolvedPath: path.resolve(r.path) }));
}

export function validatePathAgainstRoots(
  resolvedPath: string,
  operation: "read" | "write",
  roots: FsRootResolved[],
): void {
  const candidate = path.resolve(resolvedPath);

  for (const root of roots) {
    if (root.kind === "file") {
      if (candidate !== root.resolvedPath) {
        continue;
      }
      if (operation === "write" && root.access === "ro") {
        throw new Error(
          `Access denied: path '${resolvedPath}' matches read-only file root '${root.path}'`,
        );
      }
      return; // matched
    }

    // kind === "dir" — use existing isPathInside for cross-platform safety
    if (!isPathInside(root.resolvedPath, candidate)) {
      continue;
    }
    if (operation === "write" && root.access === "ro") {
      throw new Error(
        `Access denied: path '${resolvedPath}' is inside read-only root '${root.path}'`,
      );
    }
    return; // matched
  }

  throw new Error(`Access denied: path '${resolvedPath}' is outside allowed filesystem roots`);
}

/**
 * After lexical root matching, verify the path doesn't escape via symlink/hardlink.
 * Reuses OpenClaw's existing alias-safe boundary helpers.
 */
export async function assertAliasSafe(
  resolvedPath: string,
  roots: FsRootResolved[],
): Promise<void> {
  const candidate = path.resolve(resolvedPath);

  for (const root of roots) {
    const matches =
      root.kind === "file"
        ? candidate === root.resolvedPath
        : isPathInside(root.resolvedPath, candidate);
    if (matches) {
      await assertNoPathAliasEscape({
        absolutePath: candidate,
        rootPath: root.resolvedPath,
        boundaryLabel: `fs root '${root.path}'`,
        policy: PATH_ALIAS_POLICIES.strict,
      });
      return;
    }
  }
}

export function wrapToolMultiRootGuard(
  tool: AnyAgentTool,
  workspaceRoot: string,
  roots: FsRootResolved[],
  options?: { containerWorkdir?: string },
): AnyAgentTool {
  const isWriteTool = tool.name === "write" || tool.name === "edit";
  const operation = isWriteTool ? ("write" as const) : ("read" as const);

  return {
    ...tool,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const normalized = normalizeToolParams(args);
      const record =
        normalized ??
        (args && typeof args === "object" ? (args as Record<string, unknown>) : undefined);
      const filePath = record?.path;

      if (typeof filePath !== "string" || !filePath.trim()) {
        console.debug(
          `[tools.fs.roots] wrapToolMultiRootGuard: could not extract filePath from args for tool '${tool.name}', skipping roots check`,
        );
      } else {
        const resolved = resolveToolPathAgainstWorkspaceRoot({
          filePath,
          root: workspaceRoot,
          containerWorkdir: options?.containerWorkdir,
        });
        // Step 1: lexical root matching + access mode check
        validatePathAgainstRoots(resolved, operation, roots);
        // Step 2: alias-safe check (symlinks, hardlinks)
        await assertAliasSafe(resolved, roots);
      }

      return tool.execute(toolCallId, normalized ?? args, signal, onUpdate);
    },
  };
}
