import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { mergeBranch } from "../../server/worktree";

let repository: string;

function git(...args: string[]) {
  return execFileSync("git", ["-C", repository, ...args], { encoding: "utf8" }).trim();
}

function commit(file: string, content: string, message: string) {
  writeFileSync(path.join(repository, file), content);
  git("add", file);
  git("commit", "-m", message);
}

beforeEach(() => {
  repository = mkdtempSync(path.join(os.tmpdir(), "impl-merge-"));
  git("init", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  commit("README.md", "base\n", "base");
});

afterEach(() => rmSync(repository, { recursive: true, force: true }));

describe("merging an improvement branch", () => {
  it("should report the merge when the branch brings a commit", async () => {
    git("checkout", "-q", "-b", "improvement");
    commit("fix.ts", "export const fixed = true;\n", "fix: something");
    git("checkout", "-q", "main");

    await expect(mergeBranch(repository, "improvement", "apply")).resolves.toBe(true);
    expect(git("log", "-1", "--format=%s")).toBe("apply");
  });

  // The defect this guards: git answers "Already up to date" with exit code 0,
  // and the console used to announce a merge and then destroy the worktree.
  it("should report that nothing was merged when the branch holds no commit", async () => {
    git("branch", "improvement");
    const before = git("rev-parse", "HEAD");

    await expect(mergeBranch(repository, "improvement", "apply")).resolves.toBe(false);
    expect(git("rev-parse", "HEAD")).toBe(before);
  });

  it("should leave no half-merged checkout behind when the merge conflicts", async () => {
    git("checkout", "-q", "-b", "improvement");
    commit("README.md", "from the branch\n", "branch edit");
    git("checkout", "-q", "main");
    commit("README.md", "from main\n", "main edit");
    const before = git("rev-parse", "HEAD");

    await expect(mergeBranch(repository, "improvement", "apply")).rejects.toThrow();
    expect(git("rev-parse", "HEAD")).toBe(before);
    expect(git("status", "--porcelain")).toBe("");
  });
});
