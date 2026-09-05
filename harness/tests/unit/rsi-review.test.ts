import { describe, expect, it } from "@jest/globals";

// Mirrors the validation regex used in the /api/rsi/diff endpoint and applyRsiReview.
// Keeps invalid names from reaching git commands.
const WORKTREE_NAME_RE = /^[a-z0-9-]+$/i;
function isValidWorktreeName(name: string) { return !!name && WORKTREE_NAME_RE.test(name); }

describe("rsi worktree name validation", () => {
  it("should accept well-formed worktree names", () => {
    expect(isValidWorktreeName("rsi-abc123")).toBe(true);
    expect(isValidWorktreeName("rsi-a1b2c3d4")).toBe(true);
    expect(isValidWorktreeName("RSI-UPPER")).toBe(true);
  });

  it("should reject empty names", () => {
    expect(isValidWorktreeName("")).toBe(false);
  });

  it("should reject path traversal attempts", () => {
    expect(isValidWorktreeName("../secret")).toBe(false);
    expect(isValidWorktreeName("foo/bar")).toBe(false);
    expect(isValidWorktreeName("foo bar")).toBe(false);
    expect(isValidWorktreeName("; rm -rf /")).toBe(false);
  });
});
