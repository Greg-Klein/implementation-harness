import { describe, expect, it } from "@jest/globals";

// Mirrors the validation regex used in the /api/self-improvement/diff endpoint and applySelfImprovementReview.
// Keeps invalid names from reaching git commands.
const WORKTREE_NAME_RE = /^[a-z0-9-]+$/i;
function isValidWorktreeName(name: string) { return !!name && WORKTREE_NAME_RE.test(name); }

describe("self-improvement worktree name validation", () => {
  it("should accept well-formed worktree names", () => {
    expect(isValidWorktreeName("self-improvement-abc123")).toBe(true);
    expect(isValidWorktreeName("self-improvement-a1b2c3d4")).toBe(true);
    expect(isValidWorktreeName("SELF-IMPROVEMENT-UPPER")).toBe(true);
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
