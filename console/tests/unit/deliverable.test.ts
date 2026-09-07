import { describe, expect, it } from "@jest/globals";
import { branchFromCommand, createsMergeRequest, mergeRequestUrl } from "../../server/domain";

describe("run deliverable", () => {
  it("should read the branch name from the command that creates it", () => {
    expect(branchFromCommand("git checkout -b feat/258-notifications")).toBe("feat/258-notifications");
    expect(branchFromCommand("git switch -c feat/258-notifications")).toBe("feat/258-notifications");
    expect(branchFromCommand("git -C /tmp/repo switch --create feat/258")).toBe("feat/258");
    expect(branchFromCommand("git checkout -b 'feat/quoted branch'")).toBe("feat/quoted branch");
    expect(branchFromCommand('git checkout -b "feat/258" && npm test')).toBe("feat/258");
  });

  it("should read no branch from a command that creates none", () => {
    expect(branchFromCommand("git checkout develop")).toBeUndefined();
    expect(branchFromCommand("glab issue view 258 | grep -b 3 branche")).toBeUndefined();
    expect(branchFromCommand(undefined)).toBeUndefined();
  });

  it("should recognise the commands that open a merge request", () => {
    expect(createsMergeRequest("glab mr create --fill")).toBe(true);
    expect(createsMergeRequest("gh pr create --title x")).toBe(true);
    expect(createsMergeRequest("glab mr view 128")).toBe(false);
    expect(createsMergeRequest("git push -u origin feat/258")).toBe(false);
    expect(createsMergeRequest(undefined)).toBe(false);
  });

  it("should find the merge request address in a tool response of any shape", () => {
    expect(mergeRequestUrl("Creating merge request...\nhttps://gitlab.com/acme/app/-/merge_requests/128\n"))
      .toBe("https://gitlab.com/acme/app/-/merge_requests/128");
    expect(mergeRequestUrl({ stdout: "https://gitlab.com/acme/-/merge_requests/7", stderr: "" }))
      .toBe("https://gitlab.com/acme/-/merge_requests/7");
    expect(mergeRequestUrl({ stdout: "https://github.com/acme/app/pull/12" }))
      .toBe("https://github.com/acme/app/pull/12");
  });

  it("should find no address when the response carries none", () => {
    expect(mergeRequestUrl("aborted: nothing to compare")).toBeUndefined();
    expect(mergeRequestUrl(undefined)).toBeUndefined();
    expect(mergeRequestUrl(null)).toBeUndefined();
  });
});
