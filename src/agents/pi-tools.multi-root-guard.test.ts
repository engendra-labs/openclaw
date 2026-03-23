import path from "node:path";
import { describe, it, expect } from "vitest";
import { validatePathAgainstRoots, type FsRootResolved } from "./pi-tools.multi-root-guard.js";

function makeRoots(
  ...entries: Array<{ path: string; kind: "dir" | "file"; access: "ro" | "rw" }>
): FsRootResolved[] {
  return entries.map((e) => ({ ...e, resolvedPath: path.resolve(e.path) }));
}

describe("validatePathAgainstRoots", () => {
  const roots = makeRoots(
    { path: "/workspace", kind: "dir", access: "rw" },
    { path: "/data/finance", kind: "dir", access: "ro" },
    { path: "/data/context.md", kind: "file", access: "ro" },
  );

  it("allows read inside rw dir root", () => {
    expect(() => validatePathAgainstRoots("/workspace/file.txt", "read", roots)).not.toThrow();
  });

  it("allows write inside rw dir root", () => {
    expect(() => validatePathAgainstRoots("/workspace/file.txt", "write", roots)).not.toThrow();
  });

  it("allows read inside ro dir root", () => {
    expect(() => validatePathAgainstRoots("/data/finance/report.pdf", "read", roots)).not.toThrow();
  });

  it("rejects write inside ro dir root", () => {
    expect(() => validatePathAgainstRoots("/data/finance/report.pdf", "write", roots)).toThrow(
      /read-only/,
    );
  });

  it("allows read of exact file root", () => {
    expect(() => validatePathAgainstRoots("/data/context.md", "read", roots)).not.toThrow();
  });

  it("rejects read of file under file root (not a dir)", () => {
    expect(() => validatePathAgainstRoots("/data/context.md/sub", "read", roots)).toThrow(
      /outside.*roots/,
    );
  });

  it("rejects path outside all roots", () => {
    expect(() => validatePathAgainstRoots("/etc/passwd", "read", roots)).toThrow(/outside.*roots/);
  });

  it("rejects path that is a prefix but not path-separator-aware", () => {
    expect(() => validatePathAgainstRoots("/data/finance-secret/file.txt", "read", roots)).toThrow(
      /outside.*roots/,
    );
  });

  it("allows dir root path itself", () => {
    expect(() => validatePathAgainstRoots("/workspace", "read", roots)).not.toThrow();
  });

  it("allows nested paths in dir root", () => {
    expect(() => validatePathAgainstRoots("/workspace/a/b/c/d.txt", "read", roots)).not.toThrow();
  });

  it("allows write to file root with rw access", () => {
    const rwFileRoots = makeRoots({ path: "/data/output.json", kind: "file", access: "rw" });
    expect(() => validatePathAgainstRoots("/data/output.json", "write", rwFileRoots)).not.toThrow();
  });

  it("rejects all paths when roots array is empty", () => {
    expect(() => validatePathAgainstRoots("/workspace/file.txt", "read", [])).toThrow(
      /outside.*roots/,
    );
  });

  it("handles paths with .. components after resolution", () => {
    expect(() =>
      validatePathAgainstRoots("/workspace/a/../b/file.txt", "read", roots),
    ).not.toThrow();
  });

  it("handles trailing slashes on paths", () => {
    expect(() => validatePathAgainstRoots("/workspace/", "read", roots)).not.toThrow();
  });

  it("most-specific root wins for overlapping dir roots", () => {
    const overlapping = makeRoots(
      { path: "/data", kind: "dir", access: "ro" },
      { path: "/data/project", kind: "dir", access: "rw" },
    );
    // Write under /data/project should succeed (rw), not fail because /data is ro
    expect(() =>
      validatePathAgainstRoots("/data/project/file.txt", "write", overlapping),
    ).not.toThrow();
    // Write under /data (outside /data/project) should still fail (ro)
    expect(() => validatePathAgainstRoots("/data/other/file.txt", "write", overlapping)).toThrow(
      /read-only/,
    );
  });

  it("most-specific root wins regardless of order", () => {
    // Same roots but reversed order — should produce same result
    const overlapping = makeRoots(
      { path: "/data/project", kind: "dir", access: "rw" },
      { path: "/data", kind: "dir", access: "ro" },
    );
    expect(() =>
      validatePathAgainstRoots("/data/project/file.txt", "write", overlapping),
    ).not.toThrow();
    expect(() => validatePathAgainstRoots("/data/other/file.txt", "write", overlapping)).toThrow(
      /read-only/,
    );
  });

  it("file root takes precedence over dir root for exact match", () => {
    const mixed = makeRoots(
      { path: "/data", kind: "dir", access: "rw" },
      { path: "/data/secret.md", kind: "file", access: "ro" },
    );
    // Exact file match uses file root (ro), not dir root (rw)
    expect(() => validatePathAgainstRoots("/data/secret.md", "write", mixed)).toThrow(/read-only/);
    // Other files under /data use dir root (rw)
    expect(() => validatePathAgainstRoots("/data/other.md", "write", mixed)).not.toThrow();
  });
});
