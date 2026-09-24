import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { desktopExecutable } from "../../scripts/desktop-runtime.mjs";

let application: ElectronApplication;
let page: Page;
let temporary: string;
let url: string;
let project: string;
let queuedRun: string | undefined;
let launchEnvironment: Record<string, string>;

async function launchApplication() {
  const packaged = process.env.IMPL_DESKTOP_EXECUTABLE;
  application = await electron.launch({
    ...(packaged ? { executablePath: packaged, args: [] } : { executablePath: await desktopExecutable(), args: [path.resolve("."), ...(process.env.IMPL_DESKTOP_TEST_DEV ? ["--dev"] : [])] }),
    env: launchEnvironment, timeout: 120_000,
  });
  await application.evaluate(({ dialog }) => { dialog.showErrorBox = (title, message) => console.error(title, message); });
  page = await application.firstWindow();
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/$/, { timeout: 120_000 });
  await expect(page.getByLabel("Répertoire du projet", { exact: false })).toBeVisible();
  url = page.url();
}

async function openSettings() {
  const opened = application.waitForEvent("window");
  await application.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()!.items[0].submenu!.items.find((item) => item.label === "Réglages…")!.click();
  });
  const settings = await opened;
  await expect(settings.getByRole("heading", { name: "Général" })).toBeVisible();
  await expect(settings.getByLabel("Dossiers de recherche")).toBeVisible();
  return settings;
}

test.beforeEach(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "harness-electron-"));
  queuedRun = undefined;
  project = path.join(temporary, "project");
  const bin = path.join(temporary, "bin");
  await mkdir(project);
  await mkdir(bin);
  // An actual PTY and hook round-trip, without launching a real agent or ticket.
  await writeFile(path.join(bin, "claude"), `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(require('node:path').join(process.cwd(), 'agent.pid'), String(process.pid));
fs.writeFileSync(require('node:path').join(process.cwd(), 'agent.argv'), JSON.stringify(process.argv.slice(2)));
const plugin = process.argv[process.argv.indexOf('--plugin-dir') + 1];
if (!fs.existsSync(require('node:path').join(plugin, '.claude-plugin', 'plugin.json'))) process.exit(2);
console.log('DESKTOP_PTY_READY');
fetch(process.env.IMPL_HARNESS_HOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId: process.env.IMPL_RUN_ID, payload: { hook_event_name: 'SubagentStart', agent_type: 'implementation-harness:developer', agent_id: 'desktop-agent' } }) }).then(response => console.log('HOOK_STATUS=' + response.status));
setInterval(() => {}, 1000);
`);
  await chmod(path.join(bin, "claude"), 0o755);
  const envFile = path.join(temporary, "settings.env");
  await writeFile(envFile, `# Preserve this note\nPRIVATE_TEST_VALUE='not-for-the-renderer'\nIMPL_SEARCH_ROOTS='${temporary}'\nIMPL_DEMO_STEP_MS='100'\nIMPL_SELF_IMPROVEMENT_AUTORUN='false'\n`);
  const environment: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, IMPL_DESKTOP_USER_DATA: temporary, IMPL_ENV_FILE: envFile, IMPL_DATA_DIR: path.join(temporary, "data") };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.NODE_OPTIONS;
  for (const key of ["IMPL_SEARCH_ROOTS", "IMPL_MAX_CONCURRENT_RUNS", "IMPL_PERMISSION_MODE", "IMPL_REMOTE_CONTROL", "IMPL_SELF_IMPROVEMENT_AUTORUN", "IMPL_DEMO_STEP_MS", "IMPL_PLUGIN_ROOT"]) delete environment[key];
  launchEnvironment = Object.fromEntries(Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined));
  await launchApplication();
});

test.afterEach(async () => {
  if (application) {
    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    }).catch(() => undefined);
    await application.close();
    await expect.poll(async () => { try { await fetch(url, { signal: AbortSignal.timeout(1000) }); return true; } catch { return false; } }).toBe(false);
    const agentPid = await readFile(path.join(project, "agent.pid"), "utf8").catch(() => undefined);
    if (agentPid) await expect.poll(() => { try { process.kill(Number(agentPid), 0); return true; } catch { return false; } }).toBe(false);
    if (queuedRun) expect(JSON.parse(await readFile(path.join(temporary, "data", "queue.json"), "utf8"))).toEqual([expect.objectContaining({ id: queuedRun })]);
  }
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

test("should use a sandboxed window, native folder picker and persistent preferences", async () => {
  expect(await page.evaluate(() => ({ node: typeof (window as unknown as { require?: unknown }).require, bridge: typeof window.desktop?.selectDirectory }))).toEqual({ node: "undefined", bridge: "function" });
  await application.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  }, project);
  await page.getByRole("button", { name: "Parcourir les dossiers…" }).click();
  await expect(page.getByRole("combobox")).toHaveValue(project);
  await page.evaluate(() => window.desktop?.setSoundEnabled(true));
  await expect.poll(async () => JSON.parse(await readFile(path.join(temporary, "preferences.json"), "utf8")).sound).toBe(true);
  const header = await page.evaluate(async () => (await fetch("/")).headers.get("content-security-policy"));
  expect(header).toContain("object-src 'none'");
  await page.screenshot({ path: test.info().outputPath("desktop.png") });
});

test("should run the workflow, use native alerts, and reopen the requested run", async () => {
  await page.goto(`${url}?demo=1`);
  await expect(page.getByText("Décision requise")).toBeVisible();
  const runId = await page.evaluate(async () => (await (await fetch("/api/runs")).json()).runs[0].id as string);
  await application.evaluate(({ Notification, BrowserWindow }) => {
    Notification.isSupported = () => true;
    Notification.prototype.show = function () { (globalThis as unknown as { testNotification: Electron.Notification }).testNotification = this; };
    BrowserWindow.getAllWindows()[0].hide();
  });
  await page.evaluate((id) => window.desktop?.notify({ title: "Décision requise", body: "Reprendre le run", tag: "native-test", runId: id, cue: "attention" }), runId);
  await expect.poll(() => application.evaluate(() => (globalThis as unknown as { testNotification?: Electron.Notification }).testNotification?.title)).toBe("Décision requise");
  await application.evaluate(() => (globalThis as unknown as { testNotification: Electron.Notification }).testNotification.emit("click"));
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
  await page.getByRole("button", { name: "develop", exact: true }).click();
  await page.getByRole("button", { name: "Garder les alertes critiques" }).click();
  await page.getByRole("button", { name: "Transmettre à Claude" }).click();
  await expect(page).toHaveTitle("✓ Terminé · Implementation Harness");
  await application.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()!.items.find((item) => item.label === "Fichier")!.submenu!.items[0].click();
  });
  await expect(page.getByRole("combobox")).toBeVisible();
});

test("should start the native PTY and deliver hooks to the dynamically assigned port", async () => {
  await page.evaluate(({ directory }) => new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`ws://${location.host}/ws`);
    socket.onopen = () => socket.send(JSON.stringify({ type: "run.start", cwd: directory, issueUrl: "https://gitlab.com/test/local/-/issues/1" }));
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "error") { socket.close(); reject(new Error(message.message)); }
      if (message.type === "run") { socket.close(); resolve(); }
    };
  }), { directory: project });
  await expect.poll(async () => page.evaluate(async () => {
    const { runs } = await (await fetch("/api/runs")).json();
    const { state } = await (await fetch(`/api/runs/${runs[0].id}`)).json();
    return state.agents.some((agent: { id: string }) => agent.id === "desktop-agent");
  })).toBe(true);
  await expect.poll(async () => {
    const { runs } = await (await fetch(`${url}api/runs`)).json();
    return await readFile(path.join(temporary, "data", "runs", runs[0].id, "terminal.log"), "utf8");
  }).toContain("HOOK_STATUS=200");
  await page.evaluate(({ directory }) => new Promise<void>((resolve) => {
    const socket = new WebSocket(`ws://${location.host}/ws`);
    socket.onopen = () => socket.send(JSON.stringify({ type: "run.start", cwd: directory, issueUrl: "https://gitlab.com/test/local/-/issues/2" }));
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "harness" && message.snapshot.queued.length === 1) { socket.close(); resolve(); }
    };
  }), { directory: project });
  queuedRun = (await (await fetch(`${url}api/runs`)).json()).queued[0].id;
  const settings = await openSettings();
  await settings.getByRole("button", { name: "Exécutions", exact: true }).click();
  await settings.getByLabel("Runs en parallèle", { exact: true }).fill("4");
  await settings.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await application.evaluate(({ dialog }) => {
    dialog.showMessageBox = async (windowOrOptions: Electron.BaseWindow | Electron.MessageBoxOptions, options?: Electron.MessageBoxOptions) => {
      (globalThis as unknown as { restartQuestion?: string }).restartQuestion = (options ?? windowOrOptions as Electron.MessageBoxOptions).message;
      return { response: 0, checkboxChecked: false };
    };
  });
  await settings.getByRole("button", { name: "Redémarrer l’application" }).click();
  await expect.poll(() => application.evaluate(() => (globalThis as unknown as { restartQuestion?: string }).restartQuestion)).toContain("session(s) sont encore ouvertes");
  expect((await (await fetch(`${url}api/runs`)).json()).maxConcurrentRuns).toBe(3);
  expect((await (await fetch(`${url}api/runs`)).json()).queued[0].id).toBe(queuedRun);
});

test("should validate and save settings, then apply them after a native restart", async () => {
  await expect(page.evaluate(() => window.desktop!.getSettings())).rejects.toThrow("Fenêtre non autorisée");
  const settings = await openSettings();
  await page.evaluate(() => window.desktop!.openSettings());
  expect(application.windows()).toHaveLength(2);
  await expect(settings.getByLabel("Dossiers de recherche")).toHaveValue(temporary);
  expect(JSON.stringify(await settings.evaluate(() => window.desktop!.getSettings()))).not.toContain("not-for-the-renderer");
  await application.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, project);
  await settings.getByRole("button", { name: "Ajouter un dossier…" }).click();
  await expect(settings.getByLabel("Dossiers de recherche")).toHaveValue(`${temporary}\n${project}`);
  await settings.getByRole("switch", { name: "Son des alertes" }).click();
  await expect(page.getByRole("switch", { name: "Son des alertes" })).toBeChecked();
  await settings.getByRole("button", { name: "Exécutions", exact: true }).click();
  await settings.getByLabel("Runs en parallèle", { exact: true }).fill("11");
  await settings.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(settings.getByText("entier attendu entre 1 et 10")).toBeVisible();
  expect(await readFile(path.join(temporary, "settings.env"), "utf8")).not.toContain("IMPL_MAX_CONCURRENT_RUNS");
  await settings.getByLabel("Runs en parallèle", { exact: true }).fill("5");
  await settings.getByLabel("Permissions des sessions").selectOption("manual");
  await settings.getByRole("switch", { name: "Accès à distance" }).click();
  await settings.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(settings.getByText("Enregistré. Un redémarrage est nécessaire.")).toBeVisible();
  const saved = await readFile(path.join(temporary, "settings.env"), "utf8");
  expect(saved).toContain("# Preserve this note");
  expect(saved).toContain("PRIVATE_TEST_VALUE='not-for-the-renderer'");
  expect(saved).toContain("IMPL_MAX_CONCURRENT_RUNS='5'");
  expect(saved).toContain("IMPL_PERMISSION_MODE='manual'");
  expect(saved).toContain("IMPL_REMOTE_CONTROL='false'");
  expect((await (await fetch(`${url}api/runs`)).json()).maxConcurrentRuns).toBe(3);
  await settings.screenshot({ path: test.info().outputPath("settings.png") });
  // Exercise the quit/relaunch path, but let the test reattach to the new process.
  await application.evaluate(({ app }) => { app.relaunch = () => { process.getBuiltinModule("fs").writeFileSync(process.getBuiltinModule("path").join(app.getPath("userData"), "relaunch-requested"), "yes"); }; });
  const closed = application.waitForEvent("close");
  await settings.getByRole("button", { name: "Redémarrer l’application" }).click();
  await closed;
  expect(await readFile(path.join(temporary, "relaunch-requested"), "utf8")).toBe("yes");
  await launchApplication();
  expect((await (await fetch(`${url}api/runs`)).json()).maxConcurrentRuns).toBe(5);
  const reopened = await openSettings();
  expect((await reopened.evaluate(() => window.desktop!.getSettings())).restartRequired).toBe(false);
});

test("should preserve external edits and warn before discarding unsaved settings", async () => {
  const settings = await openSettings();
  await settings.getByRole("button", { name: "Exécutions", exact: true }).click();
  await settings.getByLabel("Runs en parallèle", { exact: true }).fill("4");
  await expect(settings.getByText("Modifications non enregistrées")).toBeVisible();
  await page.evaluate(async () => { window.desktop!.updateStatus({ active: 1, attention: 0 }); await window.desktop!.getPreferences(); });
  await application.evaluate(({ dialog, app }) => {
    const state = globalThis as unknown as { closeQuestions: number };
    state.closeQuestions = 0;
    dialog.showMessageBox = async () => ({ response: ++state.closeQuestions === 1 ? 1 : 0, checkboxChecked: false });
    app.quit();
  });
  // Discarding edits then cancelling shutdown must keep the open form protected.
  await expect.poll(() => application.evaluate(() => (globalThis as unknown as { closeQuestions: number }).closeQuestions)).toBe(2);
  await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith("/settings"))!.close(); });
  await expect.poll(() => application.evaluate(() => (globalThis as unknown as { closeQuestions: number }).closeQuestions)).toBe(3);
  await expect(settings.getByLabel("Runs en parallèle", { exact: true })).toHaveValue("4");
  await writeFile(path.join(temporary, "settings.env"), "IMPL_MAX_CONCURRENT_RUNS='6'\n");
  await settings.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(settings.getByText("Les réglages ont été modifiés ailleurs. Recharge-les avant d’enregistrer.")).toBeVisible();
  expect(await readFile(path.join(temporary, "settings.env"), "utf8")).toBe("IMPL_MAX_CONCURRENT_RUNS='6'\n");
  await settings.getByRole("button", { name: "Recharger les réglages" }).click();
  await expect(settings.getByLabel("Runs en parallèle", { exact: true })).toHaveValue("6");
});

test("should edit a prompt from the settings and launch the next run with it", async () => {
  const settings = await openSettings();
  await settings.getByRole("button", { name: "Prompts", exact: true }).click();
  await expect(settings.getByLabel("Prompt", { exact: true })).toHaveValue("commands/implement.md");
  await settings.getByLabel("Prompt", { exact: true }).selectOption("agents/developer.md");
  const editor = settings.locator("#prompt-content");
  await expect(editor).toHaveValue(/^---\nname: developer\n/);
  const original = await editor.inputValue();
  await editor.fill(original.replace("name: developer", "name: coder"));
  await settings.getByRole("button", { name: "Enregistrer le prompt" }).click();
  await expect(settings.getByText("Le champ « name » doit rester « developer »")).toBeVisible();
  await editor.fill(`${original}\nDESKTOP_PROMPT_EDIT\n`);
  await settings.getByRole("button", { name: "Enregistrer le prompt" }).click();
  await expect(settings.getByText("Prompt enregistré. Il s’applique aux prochains runs.")).toBeVisible();
  await expect(settings.getByRole("option", { name: "developer · modifié" })).toBeAttached();
  await settings.getByLabel("Prompt", { exact: true }).selectOption("system.md");
  await settings.locator("#prompt-content").fill("DESKTOP_SYSTEM_EDIT");
  await settings.getByRole("button", { name: "Enregistrer le prompt" }).click();
  await expect(settings.getByText("Prompt enregistré. Il s’applique aux prochains runs.")).toBeVisible();
  expect(await readFile(path.join(temporary, "data", "prompts", "agents", "developer.md"), "utf8")).toContain("DESKTOP_PROMPT_EDIT");
  await settings.screenshot({ path: test.info().outputPath("prompts.png") });

  await page.evaluate(({ directory }) => new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`ws://${location.host}/ws`);
    socket.onopen = () => socket.send(JSON.stringify({ type: "run.start", cwd: directory, issueUrl: "https://gitlab.com/test/local/-/issues/1" }));
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "error") { socket.close(); reject(new Error(message.message)); }
      if (message.type === "run") { socket.close(); resolve(); }
    };
  }), { directory: project });
  const argv = await expect.poll(() => readFile(path.join(project, "agent.argv"), "utf8").catch(() => "")).not.toBe("").then(async () => JSON.parse(await readFile(path.join(project, "agent.argv"), "utf8")) as string[]);
  expect(argv[argv.indexOf("--append-system-prompt") + 1]).toBe("DESKTOP_SYSTEM_EDIT");
  const pluginDir = argv[argv.indexOf("--plugin-dir") + 1];
  expect(pluginDir.startsWith(path.join(temporary, "data", "runs"))).toBe(true);
  expect(await readFile(path.join(pluginDir, "agents", "developer.md"), "utf8")).toContain("DESKTOP_PROMPT_EDIT");
  expect(await readFile(path.resolve("..", "agents", "developer.md"), "utf8")).not.toContain("DESKTOP_PROMPT_EDIT");
});
