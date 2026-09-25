const { before, beforeEach, afterEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let createSettingsStore;
let directory;
let envFile;
let store;
before(async () => { ({ createSettingsStore } = await import("../../electron/settings-store.mjs")); });
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "harness-settings-"));
  envFile = path.join(directory, ".env");
  // Imposed so that the harness checkout detection never scans the real ~/workspace.
  store = createSettingsStore({ envFile, environment: { IMPL_SEARCH_ROOTS: directory }, bundledPlugin: true });
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
const save = (values, revision = store.snapshot().revision) => store.save({ revision, values });
function makeCheckout(relative, name) {
  const checkout = path.join(directory, relative);
  fs.mkdirSync(path.join(checkout, ".git"), { recursive: true });
  fs.mkdirSync(path.join(checkout, ".claude-plugin"));
  fs.writeFileSync(path.join(checkout, ".claude-plugin", "plugin.json"), JSON.stringify({ name }));
  return checkout;
}

describe("desktop configuration storage", () => {
  it("should expose editable values without leaking unrelated configuration", () => {
    fs.writeFileSync(envFile, "PRIVATE_TOKEN='hidden'\nIMPL_MAX_CONCURRENT_RUNS='4'\n");
    const snapshot = store.snapshot();
    assert.equal(snapshot.values.IMPL_MAX_CONCURRENT_RUNS, "4");
    assert.equal(snapshot.sources.IMPL_MAX_CONCURRENT_RUNS, "file");
    assert.equal(snapshot.sources.IMPL_REMOTE_CONTROL, "default");
    assert.equal(snapshot.values.IMPL_PERMISSION_MODE, "auto");
    assert.equal(JSON.stringify(snapshot).includes("hidden"), false);
    assert.equal(JSON.stringify(snapshot).includes("PRIVATE_TOKEN"), false);
  });

  it("should preserve comments, unknown values and permissions when saving", () => {
    fs.writeFileSync(envFile, "# Keep this note\nPRIVATE_TOKEN='hidden'\nIMPL_MAX_CONCURRENT_RUNS='2'\nIMPL_MAX_CONCURRENT_RUNS='3'\n", { mode: 0o600 });
    store.markApplied();
    const result = save({ IMPL_MAX_CONCURRENT_RUNS: "5" });
    assert.equal(result.ok, true);
    assert.equal(result.snapshot.restartRequired, true);
    assert.equal(fs.readFileSync(envFile, "utf8"), "# Keep this note\nPRIVATE_TOKEN='hidden'\nIMPL_MAX_CONCURRENT_RUNS='2'\nIMPL_MAX_CONCURRENT_RUNS='5'\n");
    assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);
    store.markApplied();
    assert.equal(store.snapshot().restartRequired, false);
  });

  it("should validate all fields before writing and reject unknown keys", () => {
    const result = save({ IMPL_MAX_CONCURRENT_RUNS: "11", IMPL_REMOTE_CONTROL: "no", IMPL_SEARCH_ROOTS: "", IMPL_DEMO_STEP_MS: "0", IMPL_PERMISSION_MODE: "plan" });
    assert.equal(result.ok, false);
    assert.equal(Object.keys(result.errors).length, 5);
    assert.equal(fs.existsSync(envFile), false);
    assert.equal(save({ NODE_OPTIONS: "--require=/tmp/code.js" }).ok, false);
    assert.equal(save({ IMPL_PLUGIN_ROOT: "x\nNODE_OPTIONS=hello" }).ok, false);
    assert.equal(fs.existsSync(envFile), false);
  });

  it("should reject stale edits instead of overwriting an external change", () => {
    const revision = store.snapshot().revision;
    fs.writeFileSync(envFile, "IMPL_MAX_CONCURRENT_RUNS='7'\n");
    assert.equal(save({ IMPL_MAX_CONCURRENT_RUNS: "4" }, revision).conflict, true);
    assert.equal(store.snapshot().values.IMPL_MAX_CONCURRENT_RUNS, "7");
  });

  it("should respect values imposed by the launch environment", () => {
    fs.writeFileSync(envFile, "IMPL_MAX_CONCURRENT_RUNS='3'\n");
    store = createSettingsStore({ envFile, environment: { IMPL_MAX_CONCURRENT_RUNS: "8" } });
    assert.equal(store.snapshot().sources.IMPL_MAX_CONCURRENT_RUNS, "environment");
    assert.equal(save({ IMPL_MAX_CONCURRENT_RUNS: "4" }).ok, false);
    assert.equal(save({ IMPL_MAX_CONCURRENT_RUNS: "8", IMPL_REMOTE_CONTROL: "false" }).ok, true);
    assert.match(fs.readFileSync(envFile, "utf8"), /IMPL_MAX_CONCURRENT_RUNS='3'/);
  });

  it("should turn the autonomous audit on by default, and say so when no harness checkout backs it", () => {
    const snapshot = store.snapshot();
    assert.equal(snapshot.values.IMPL_SELF_IMPROVEMENT_AUTORUN, "true");
    assert.equal(snapshot.values.IMPL_PLUGIN_ROOT, "");
    assert.match(snapshot.warnings.IMPL_PLUGIN_ROOT.join(" "), /auto-audit reste inactif/);
    // The other settings stay editable while no checkout is found.
    assert.equal(save({ IMPL_MAX_CONCURRENT_RUNS: "4" }).ok, true);
    assert.equal(save({ IMPL_PLUGIN_ROOT: directory }).ok, false);
  });

  it("should find the harness checkout in the search roots when none was chosen", () => {
    const harness = makeCheckout("workspace/implementation-harness", "implementation-harness");
    makeCheckout("another", "another-plugin");
    const found = createSettingsStore({ envFile, environment: { IMPL_SEARCH_ROOTS: directory }, bundledPlugin: true }).snapshot();
    assert.equal(found.values.IMPL_PLUGIN_ROOT, harness);
    assert.equal(found.sources.IMPL_PLUGIN_ROOT, "default");
    assert.equal(found.warnings.IMPL_PLUGIN_ROOT, undefined);
    // Found, not chosen: nothing is written for it.
    assert.equal(fs.existsSync(envFile), false);
  });

  it("should keep a checkout cleared on purpose, and refuse it only while the audit stays on", () => {
    makeCheckout("implementation-harness", "implementation-harness");
    store = createSettingsStore({ envFile, environment: { IMPL_SEARCH_ROOTS: directory }, bundledPlugin: true });
    assert.equal(save({ IMPL_PLUGIN_ROOT: "" }).ok, false);
    assert.equal(save({ IMPL_PLUGIN_ROOT: "", IMPL_SELF_IMPROVEMENT_AUTORUN: "false" }).ok, true);
    assert.equal(store.snapshot().values.IMPL_PLUGIN_ROOT, "");
    assert.equal(save({ IMPL_SELF_IMPROVEMENT_AUTORUN: "true" }).ok, false);
  });

  it("should accept a harness checkout chosen by hand, outside the search roots", () => {
    const harness = makeCheckout("elsewhere", "implementation-harness");
    fs.mkdirSync(path.join(directory, "roots"));
    store = createSettingsStore({ envFile, environment: { IMPL_SEARCH_ROOTS: path.join(directory, "roots") }, bundledPlugin: true });
    assert.equal(save({ IMPL_PLUGIN_ROOT: harness, IMPL_SELF_IMPROVEMENT_AUTORUN: "true" }).ok, true);
    assert.equal(store.snapshot().sources.IMPL_PLUGIN_ROOT, "file");
  });

  it("should report inaccessible or malformed configuration without replacing it", () => {
    fs.writeFileSync(envFile, "IMPL_SEARCH_ROOTS='unfinished\n");
    assert.equal(save({ IMPL_SEARCH_ROOTS: directory }).ok, false);
    assert.equal(fs.readFileSync(envFile, "utf8"), "IMPL_SEARCH_ROOTS='unfinished\n");
    fs.unlinkSync(envFile);
    fs.mkdirSync(envFile);
    assert.throws(() => store.snapshot(), /Impossible de lire/);
  });
});
