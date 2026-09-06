import { describe, expect, it } from "@jest/globals";
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";

const launcherPath = path.resolve(process.cwd(), "..", "bin", "implementation-harness");
const source = readFileSync(launcherPath, "utf8");

function launch(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync("bash", [launcherPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 20_000,
  });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function available(command: string) {
  return spawnSync("bash", ["-c", `command -v ${command}`], { stdio: "ignore" }).status === 0;
}

/** Un port sur lequel rien n'écoute, pour ne jamais toucher une exécution réelle. */
async function freePort() {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

function listenInChildProcess(port: number) {
  return spawn("node", ["-e", `require("http").createServer((_, response) => response.end("ok")).listen(${port}, "127.0.0.1")`], { stdio: "ignore" });
}

function waitForExit(child: ChildProcess, timeoutMs: number) {
  return new Promise<boolean>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve(true);
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => { clearTimeout(timer); resolve(true); });
  });
}

describe("implementation-harness launcher", () => {
  it("should be valid bash", () => {
    expect(() => execFileSync("bash", ["-n", launcherPath])).not.toThrow();
  });

  it("should document every subcommand it accepts", () => {
    const { code, stdout } = launch(["help"]);
    expect(code).toBe(0);
    for (const subcommand of ["demo", "restart", "stop", "status", "improve", "help"]) {
      expect(stdout).toContain(subcommand);
    }
  });

  it("should print the usage on --help and -h as well", () => {
    for (const flag of ["--help", "-h"]) {
      const { code, stdout } = launch([flag]);
      expect(code).toBe(0);
      expect(stdout).toContain("Usage :");
    }
  });

  it("should refuse an unknown command instead of starting the server", async () => {
    const port = await freePort();
    const { code, stderr } = launch(["statut"], { IMPL_PORT: String(port), IMPL_NO_OPEN: "1" });
    expect(code).toBe(1);
    expect(stderr).toContain("Commande inconnue : statut");
  });

  it("should refuse extra arguments", async () => {
    const port = await freePort();
    const { code, stderr } = launch(["demo", "extra"], { IMPL_PORT: String(port), IMPL_NO_OPEN: "1" });
    expect(code).toBe(1);
    expect(stderr).toContain("Trop d'arguments");
  });

  it("should report a quiet port on stop", async () => {
    const port = await freePort();
    const { code, stdout } = launch(["stop"], { IMPL_PORT: String(port) });
    expect(code).toBe(0);
    expect(stdout).toContain("Aucun serveur");
  });

  it("should report a stopped server with its own exit code", async () => {
    const port = await freePort();
    const { code, stdout } = launch(["status"], { IMPL_PORT: String(port) });
    // 3 distingue "arrêté" d'une erreur d'usage, qui sort en 1.
    expect(code).toBe(3);
    expect(stdout).toContain("Arrêté");
  });

  const canInspectPorts = available("lsof");

  (canInspectPorts ? it : it.skip)("should fail the status when the port answers but the harness does not", async () => {
    const port = await freePort();
    const child = listenInChildProcess(port);
    await new Promise((resolve) => setTimeout(resolve, 400));
    try {
      const { code, stderr } = launch(["status"], { IMPL_PORT: String(port) });
      expect(code).toBe(1);
      expect(stderr).toContain("/api/state");
    } finally {
      child.kill("SIGKILL");
    }
  }, 20_000);

  (canInspectPorts ? it : it.skip)("should reject a bad restart argument before stopping anything", async () => {
    const port = await freePort();
    const child = listenInChildProcess(port);
    await new Promise((resolve) => setTimeout(resolve, 400));
    try {
      const { code, stderr } = launch(["restart", "bogus"], { IMPL_PORT: String(port), IMPL_NO_OPEN: "1" });
      expect(code).toBe(1);
      expect(stderr).toContain("restart n'accepte que le mode démo");
      // Une invocation refusée ne doit pas laisser le serveur arrêté derrière elle.
      expect(await waitForExit(child, 500)).toBe(false);
    } finally {
      child.kill("SIGKILL");
    }
  }, 20_000);

  (canInspectPorts ? it : it.skip)("should free the port on stop", async () => {
    const port = await freePort();
    const child = listenInChildProcess(port);
    await new Promise((resolve) => setTimeout(resolve, 400));
    try {
      const { code, stdout } = launch(["stop"], { IMPL_PORT: String(port) });
      expect(code).toBe(0);
      expect(stdout).toContain("Arrêt du serveur");
      // Le contrat de restart : un serveur en cours sert le manifeste Next.js de
      // son propre build, donc il doit disparaitre avant qu'un autre demarre.
      expect(await waitForExit(child, 5_000)).toBe(true);
    } finally {
      child.kill("SIGKILL");
    }
  }, 20_000);

  it("should not reference the former project name", () => {
    expect(source).not.toMatch(/x-implement|ximpl|X_IMPLEMENT_/);
  });
});
