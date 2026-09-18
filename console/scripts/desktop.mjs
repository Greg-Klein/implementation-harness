import { spawn } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { desktopExecutable } from "./desktop-runtime.mjs";

const root = path.resolve(import.meta.dirname, "..");
if (!process.argv.includes("--dev") && !existsSync(path.join(root, ".next", "BUILD_ID"))) {
  console.error("La version de production manque. Lance npm run desktop:build, ou npm run desktop:dev pour développer.");
  process.exit(1);
}
if (!existsSync(path.join(root, ".desktop", "server.mjs"))) {
  console.error("Le serveur Electron manque. Lance npm run desktop:build ou npm run desktop:dev.");
  process.exit(1);
}
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.NODE_OPTIONS;
const child = spawn(await desktopExecutable(), [root, ...process.argv.slice(2)], { env: environment, stdio: "inherit" });
child.on("error", (error) => { console.error(error); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
