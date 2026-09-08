import { describe, expect, it } from "@jest/globals";
import { hasAuditableEvidence } from "../../server/domain";

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

