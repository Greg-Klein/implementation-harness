import { describe, expect, it } from "@jest/globals";
import { hasAuditableEvidence, withoutBundlerVariables } from "../../server/domain";

describe("autonomous audit evidence", () => {
  it("should audit a run that delegated an agent", () => {
    expect(hasAuditableEvidence({ status: "completed", agents: [{ id: "a", name: "developer", status: "completed", startedAt: "2026-09-08T08:00:00.000Z" }], artifacts: [] })).toBe(true);
  });

  it("should audit a run that produced a document", () => {
    expect(hasAuditableEvidence({ status: "completed", agents: [], artifacts: ["plan.md"] })).toBe(true);
  });

  it("should audit a run that failed, even with nothing to show", () => {
    expect(hasAuditableEvidence({ status: "failed", agents: [], artifacts: [] })).toBe(true);
  });

  it("should skip a session stopped before it did anything", () => {
    expect(hasAuditableEvidence({ status: "completed", agents: [], artifacts: [] })).toBe(false);
    expect(hasAuditableEvidence({ status: "idle", agents: [], artifacts: [] })).toBe(false);
  });
});

describe("environment handed to the improvement agent", () => {
  it("should drop the bundler variables the console itself runs with", () => {
    const cleaned = withoutBundlerVariables({ NODE_ENV: "development", TURBOPACK: "1", __NEXT_PRIVATE_ORIGIN: "http://localhost", NEXT_DEPLOYMENT_ID: "x", PATH: "/usr/bin" });
    expect(cleaned).toEqual({ PATH: "/usr/bin" });
  });

  it("should leave the harness configuration alone", () => {
    const cleaned = withoutBundlerVariables({ IMPL_SELF_IMPROVEMENT_AUTORUN: "true", HOME: "/Users/x" });
    expect(cleaned).toEqual({ IMPL_SELF_IMPROVEMENT_AUTORUN: "true", HOME: "/Users/x" });
  });
});
