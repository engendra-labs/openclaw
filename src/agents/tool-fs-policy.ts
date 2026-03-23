import type { OpenClawConfig } from "../config/config.js";
import type { FsRoot } from "../config/types.tools.js";
import { resolveAgentConfig } from "./agent-scope.js";

export type ToolFsPolicy = {
  workspaceOnly: boolean;
  roots?: FsRoot[];
};

export function createToolFsPolicy(params: {
  workspaceOnly?: boolean;
  roots?: FsRoot[];
}): ToolFsPolicy {
  if (params.roots && params.workspaceOnly) {
    console.warn(
      "[tools.fs] Both workspaceOnly and roots are set. roots takes precedence — remove workspaceOnly to avoid ambiguity.",
    );
  }
  return {
    workspaceOnly: params.roots ? false : params.workspaceOnly === true,
    roots: params.roots,
  };
}

export function resolveToolFsConfig(params: { cfg?: OpenClawConfig; agentId?: string }): {
  workspaceOnly?: boolean;
  roots?: FsRoot[];
} {
  const cfg = params.cfg;
  const globalFs = cfg?.tools?.fs;
  const agentFs =
    cfg && params.agentId ? resolveAgentConfig(cfg, params.agentId)?.tools?.fs : undefined;

  // Agent-level roots take full precedence
  const roots = agentFs?.roots ?? globalFs?.roots;
  if (roots && roots.length > 0) {
    return { roots };
  }

  return {
    workspaceOnly: agentFs?.workspaceOnly ?? globalFs?.workspaceOnly,
  };
}

export function resolveEffectiveToolFsWorkspaceOnly(params: {
  cfg?: OpenClawConfig;
  agentId?: string;
}): boolean {
  const config = resolveToolFsConfig(params);
  // When roots is set, workspaceOnly is irrelevant (roots takes precedence)
  return !config.roots && config.workspaceOnly === true;
}
