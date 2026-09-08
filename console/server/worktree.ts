import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { pluginRoot } from "./config.js";

const exec = promisify(execFile);

export type Worktree = { path: string; branch?: string };

/**
 * The agent is free to rename the branch it creates for a worktree, and Claude
 * Code does exactly that by prefixing it with "worktree-". The directory name
 * is the only handle that stays what the harness asked for, whichever engine
 * created it.
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

/** The point where the worktree left the branch the harness itself runs on. */
async function mergeBase(worktree: Worktree) {
  const branch = (await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: pluginRoot })).stdout.trim();
  return (await exec("git", ["merge-base", "HEAD", branch], { cwd: worktree.path })).stdout.trim();
}

/** Committed and uncommitted work, measured from the point where the worktree left the harness branch. */
export async function worktreeDiff(worktree: Worktree) {
  const base = await mergeBase(worktree);
  const { stdout } = await exec("git", ["diff", base], { cwd: worktree.path, maxBuffer: 2 * 1024 * 1024 });
  return stdout;
}

/**
 * Commits the worktree added on top of the harness branch. Uncommitted work is
 * deliberately not counted: /implementation-harness:improve leaves the branch
 * uncommitted when its own validation fails, and that state must never be
 * offered for promotion.
 */
export async function worktreeCommitCount(worktree: Worktree) {
  const base = await mergeBase(worktree);
  const { stdout } = await exec("git", ["rev-list", "--count", `${base}..HEAD`], { cwd: worktree.path });
  return Number(stdout.trim()) || 0;
}

/**
 * Merges an improvement branch into a checkout and reports whether it brought
 * anything. Git answers "Already up to date" with a zero exit code, so the exit
 * code alone cannot tell a real merge from a branch that holds no commit, and a
 * conflict leaves the checkout half-merged unless it is aborted here.
 */
export async function mergeBranch(repository: string, branch: string, message: string) {
  const head = async () => (await exec("git", ["-C", repository, "rev-parse", "HEAD"])).stdout.trim();
  const before = await head();
  try {
    await exec("git", ["-C", repository, "merge", "--no-ff", branch, "-m", message]);
  } catch (error) {
    await exec("git", ["-C", repository, "merge", "--abort"]).catch(() => undefined);
    throw error;
  }
  return (await head()) !== before;
}
