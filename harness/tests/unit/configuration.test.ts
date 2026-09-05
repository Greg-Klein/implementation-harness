import { describe, expect, it } from "@jest/globals";
import { gitLabProjectPath, parseRepositoryMappings, positiveDuration } from "../../server/domain";

describe("harness configuration", () => {
  it("should use positive durations and reject invalid overrides", () => {
    expect(positiveDuration("500", 5_000)).toBe(500);
    expect(positiveDuration("0", 5_000)).toBe(5_000);
    expect(positiveDuration("invalid", 5_000)).toBe(5_000);
  });

  it("should extract nested GitLab project paths from issue URLs", () => {
    expect(gitLabProjectPath("https://gitlab.com/group/platform/repo/-/issues/42")).toBe("group/platform/repo");
    expect(gitLabProjectPath("https://gitlab.com/group/repo/-/merge_requests/42")).toBeUndefined();
    expect(gitLabProjectPath("not-a-url")).toBeUndefined();
  });

  it("should keep only string repository mappings", () => {
    expect(parseRepositoryMappings('{"group/repo":"~/workspace/repo","invalid":42}')).toEqual({ "group/repo": "~/workspace/repo" });
    expect(parseRepositoryMappings("invalid-json")).toEqual({});
    expect(parseRepositoryMappings("[]")).toEqual({});
  });
});
