import { describe, expect, it } from "@jest/globals";
import path from "node:path";
import { imageMimeType, phaseForArtifact, resolveArtifactPath } from "../../server/domain";

describe("artifact handling", () => {
  it("should resolve files located inside the run directory", () => {
    const root = path.resolve("/tmp/implementation-harness-run/artifacts");
    expect(resolveArtifactPath(root, "reviews/senior.md")).toBe(path.join(root, "reviews/senior.md"));
  });

  it("should reject path traversal and sibling directories", () => {
    const root = path.resolve("/tmp/implementation-harness-run/artifacts");
    expect(resolveArtifactPath(root, "../run.json")).toBeUndefined();
    expect(resolveArtifactPath(root, "/tmp/secret.txt")).toBeUndefined();
    expect(resolveArtifactPath(root, "../../artifacts-copy/secret.txt")).toBeUndefined();
  });

  it("should recognize previewable image formats", () => {
    expect(imageMimeType("capture.PNG")).toBe("image/png");
    expect(imageMimeType("diagram.svg")).toBe("image/svg+xml");
    expect(imageMimeType("report.md")).toBeUndefined();
  });

  it("should map generated documents to workflow phases", () => {
    expect(phaseForArtifact("ticket-context.md")).toBe(1);
    expect(phaseForArtifact("nested/developer-report-2.md")).toBe(5);
    expect(phaseForArtifact("senior-review.md")).toBe(6);
    expect(phaseForArtifact("mr-description.md")).toBe(8);
    expect(phaseForArtifact("unknown.txt")).toBe(0);
  });
});
