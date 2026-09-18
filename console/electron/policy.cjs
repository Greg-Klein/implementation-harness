const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

function isAppUrl(value, origin) {
  try { return Boolean(origin) && new URL(value).origin === origin; }
  catch { return false; }
}

function isExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

/** Finder does not inherit the PATH configured by nvm, Homebrew or Claude Code. */
async function shellPath(environment) {
  if (process.platform === "win32") return environment.PATH ?? "";
  let loginPath = "";
  try {
    const { stdout } = await promisify(execFile)(environment.SHELL || "/bin/zsh", ["-ilc", 'printf "\\036%s\\036" "$PATH"'], {
      env: environment, timeout: 5_000, maxBuffer: 1024 * 1024,
    });
    loginPath = stdout.split("\x1e")[1] ?? "";
  } catch { /* A broken shell profile must not prevent the application opening. */ }
  return [...new Set([
    ...(environment.PATH ?? "").split(path.delimiter), ...loginPath.split(path.delimiter),
    path.join(os.homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin",
  ].filter(Boolean))].join(path.delimiter);
}

function windowBounds(saved, displays) {
  if (!saved || ![saved.x, saved.y, saved.width, saved.height].every(Number.isFinite)) return {};
  const visible = displays.some(({ workArea: area }) =>
    saved.x + saved.width > area.x + 80 && saved.x < area.x + area.width - 80
    && saved.y >= area.y && saved.y < area.y + area.height - 80);
  return visible ? { x: saved.x, y: saved.y, width: Math.max(1000, saved.width), height: Math.max(700, saved.height) } : {};
}

module.exports = { isAppUrl, isExternalUrl, shellPath, windowBounds };
