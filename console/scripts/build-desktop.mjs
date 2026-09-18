import { build } from "esbuild";
import path from "node:path";
import sharp from "sharp";

await build({
  absWorkingDir: path.resolve(import.meta.dirname, ".."),
  entryPoints: ["server/index.ts"], outfile: ".desktop/server.mjs",
  bundle: true, platform: "node", target: "node22", format: "esm", packages: "external",
  sourcemap: true,
});
await sharp(path.resolve(import.meta.dirname, "../electron/icon.svg"))
  .png().toFile(path.resolve(import.meta.dirname, "../.desktop/icon.png"));
await build({
  absWorkingDir: path.resolve(import.meta.dirname, ".."),
  entryPoints: ["electron/settings-store.mjs"], outfile: ".desktop/settings-store.cjs",
  bundle: true, platform: "node", target: "node22", format: "cjs", packages: "external",
});
