import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Discovery reads real .git/config files, so the integration suite needs a real
 * checkout. Committing a nested .git directory would turn the fixture into an
 * embedded repository, so it is built outside the working tree instead.
 */
export const checkoutsRoot = path.join(os.tmpdir(), "implementation-harness-tests", "checkouts");
export const sampleCheckout = path.join(checkoutsRoot, "repo");
export const sampleProject = "group/repo";

export function createSampleCheckout() {
  mkdirSync(path.join(sampleCheckout, ".git"), { recursive: true });
  writeFileSync(
    path.join(sampleCheckout, ".git", "config"),
    `[remote "origin"]\n\turl = https://gitlab.com/${sampleProject}.git\n`,
  );
  return sampleCheckout;
}
