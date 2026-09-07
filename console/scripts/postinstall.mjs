import { chmod, readdir } from "node:fs/promises";
import path from "node:path";

// npm unpacks node-pty's prebuilt spawn-helper without its executable bit, and
// node-pty then fails with "posix_spawnp failed" when it opens the terminal.
const prebuilds = path.join(import.meta.dirname, "..", "node_modules", "node-pty", "prebuilds");

for (const platform of await readdir(prebuilds).catch(() => [])) {
  await chmod(path.join(prebuilds, platform, "spawn-helper"), 0o755).catch(() => undefined);
}
