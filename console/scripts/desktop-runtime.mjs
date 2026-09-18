import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const execute = promisify(execFile);

/** macOS reads the application-menu name from its bundle, not app.setName(). */
export async function desktopExecutable() {
  const executable = require("electron");
  if (process.platform !== "darwin") return executable;

  const directory = path.resolve(import.meta.dirname, "../.desktop-runtime");
  const bundle = path.join(directory, "Implementation Harness.app");
  const target = path.join(bundle, "Contents/MacOS/Electron");
  const stamp = path.join(directory, "runtime.json");
  const fingerprint = JSON.stringify({ executable, modified: (await stat(executable)).mtimeMs, version: 2 });
  if (await readFile(stamp, "utf8").catch(() => "") === fingerprint && await stat(target).catch(() => false)) return target;

  console.log("Préparation du lanceur macOS Implementation Harness…");
  await mkdir(directory, { recursive: true });
  await rm(bundle, { recursive: true, force: true });
  // Keep the installed Electron package intact and reuse this local copy.
  await cp(path.resolve(executable, "../../.."), bundle, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
  const plist = path.join(bundle, "Contents/Info.plist");
  for (const [key, value] of Object.entries({ CFBundleName: "Implementation Harness", CFBundleDisplayName: "Implementation Harness", CFBundleIdentifier: "dev.implementation-harness.development" })) {
    await execute("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plist]);
  }
  // Local development needs an ad-hoc signature, without Apple credentials.
  await execute("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", "--preserve-metadata=entitlements,flags", bundle]);
  await writeFile(stamp, fingerprint);
  return target;
}
