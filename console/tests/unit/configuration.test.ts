import { describe, expect, it } from "@jest/globals";
import { gitLabProjectPath, gitRemoteProjects, positiveDuration } from "../../server/domain";

describe("harness configuration", () => {
  it("should use positive durations and reject invalid overrides", () => {
    expect(positiveDuration("500", 5_000)).toBe(500);
    expect(positiveDuration("0", 5_000)).toBe(5_000);
    expect(positiveDuration("invalid", 5_000)).toBe(5_000);
  });

  it("should extract nested GitLab project paths from issue URLs", () => {
    expect(gitLabProjectPath("https://gitlab.com/group/platform/repo/-/issues/42")).toBe("group/platform/repo");
    expect(gitLabProjectPath("https://gitlab.com/group/platform/repo/-/work_items/42")).toBe("group/platform/repo");
    expect(gitLabProjectPath("https://gitlab.com/group/repo/-/merge_requests/42")).toBeUndefined();
    expect(gitLabProjectPath("not-a-url")).toBeUndefined();
  });

  it("should read project paths from every remote form", () => {
    const config = [
      '[remote "origin"]',
      "\turl = git@gitlab.com:group/platform/repo.git",
      '[remote "mirror"]',
      "\turl = https://gitlab.com/group/other.git",
      '[remote "ssh"]',
      "\turl = ssh://git@gitlab.com/group/third",
    ].join("\n");
    expect(gitRemoteProjects(config)).toEqual(["group/platform/repo", "group/other", "group/third"]);
  });

  it("should ignore a git config without any usable remote", () => {
    expect(gitRemoteProjects("[core]\n\tbare = false\n")).toEqual([]);
    expect(gitRemoteProjects("")).toEqual([]);
  });
});
