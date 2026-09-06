import { describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const launcherPath = path.resolve(process.cwd(), "..", "bin", "implementation-harness");
const source = readFileSync(launcherPath, "utf8");

describe("implementation-harness launcher", () => {
  it("should be valid bash", () => {
    expect(() => execFileSync("bash", ["-n", launcherPath])).not.toThrow();
  });

  it("should route every documented subcommand", () => {
    for (const subcommand of ["improve", "restart", "demo"]) {
      expect(source).toContain(`"$command" == "${subcommand}"`);
    }
  });

  it("should free the port before restarting so a stale build is never served", () => {
    expect(source).toContain("stop_server");
    // Le serveur en cours garde le manifeste Next.js de son propre build : sans
    // arret prealable, la page est servie avec des feuilles de style absentes.
    expect(source).toMatch(/stop_server\n\s+shift/);
  });

  it("should not reference the former project name", () => {
    expect(source).not.toMatch(/x-implement|ximpl|X_IMPLEMENT_/);
  });
});
