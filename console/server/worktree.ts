import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { pluginRoot } from "./config.js";

const exec = promisify(execFile);

export type Worktree = { path: string; branch?: string };

/**
 * Claude Code prefixes the branch of a --worktree session with "worktree-", so
 * the directory name is the only stable handle on the worktree.
 */
export async function findWorktree(name: string): Promise<Worktree | undefined> {
  const { stdout } = await exec("git", ["worktree", "list", "--porcelain"], { cwd: pluginRoot });
  return stdout.split("\n\n").flatMap((block) => {
    const lines = block.split("\n");
    const worktreePath = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
    if (!worktreePath || path.basename(worktreePath) !== name) return [];
    return [{ path: worktreePath, branch: lines.find((line) => line.startsWith("branch refs/heads/"))?.slice("branch refs/heads/".length) }];
  })[0];
}

/** Committed and uncommitted work, measured from the point where the worktree left the harness branch. */
export async function worktreeDiff(worktree: Worktree) {
  const branch = (await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: pluginRoot })).stdout.trim();
  const base = (await exec("git", ["merge-base", "HEAD", branch], { cwd: worktree.path })).stdout.trim();
  const { stdout } = await exec("git", ["diff", base], { cwd: worktree.path, maxBuffer: 2 * 1024 * 1024 });
  return stdout;
}
