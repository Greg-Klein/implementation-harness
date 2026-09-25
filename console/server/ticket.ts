import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gitLabIssueEndpoint } from "./domain.js";

const exec = promisify(execFile);

export async function fetchTicketTitle(issueUrl: string, cwd: string) {
  const endpoint = gitLabIssueEndpoint(issueUrl);
  if (!endpoint) return undefined;
  try {
    const { stdout } = await exec("glab", ["api", "--hostname", endpoint.hostname, endpoint.path], { cwd, timeout: 15_000 });
    const title = (JSON.parse(stdout) as { title?: unknown }).title;
    return typeof title === "string" && title.trim() ? title.trim() : undefined;
  } catch {
    return undefined;
  }
}
