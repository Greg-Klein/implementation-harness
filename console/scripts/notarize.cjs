const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { mkdtemp, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const exec = promisify(execFile);

module.exports = async ({ electronPlatformName, appOutDir, packager }) => {
  const profile = process.env.IMPL_NOTARY_PROFILE;
  if (electronPlatformName !== "darwin" || !profile) return;
  const appPath = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "harness-notarize-"));
  try {
    await exec("codesign", ["--verify", "--deep", "--strict", appPath]);
    const archive = path.join(temporary, "application.zip");
    await exec("ditto", ["-c", "-k", "--keepParent", appPath, archive]);
    console.log("Envoi de l’application signée au service de notarisation Apple…");
    const { stdout } = await exec("xcrun", ["notarytool", "submit", archive, "--keychain-profile", profile, "--wait", "--output-format", "json"], { maxBuffer: 4 * 1024 * 1024 });
    const result = JSON.parse(stdout);
    if (result.status !== "Accepted") throw new Error(`Notarisation ${result.status}. Consulter : xcrun notarytool log ${result.id} --keychain-profile <profil>`);
    await exec("xcrun", ["stapler", "staple", appPath]);
    await exec("xcrun", ["stapler", "validate", appPath]);
    console.log(`Notarisation acceptée : ${result.id}`);
  } finally { await rm(temporary, { recursive: true, force: true }); }
};
