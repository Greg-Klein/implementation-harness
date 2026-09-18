const { app, BrowserWindow, Menu, Notification, dialog, ipcMain, screen, shell, utilityProcess } = require("electron");
const { mkdirSync, readFileSync, writeFileSync, appendFileSync } = require("node:fs");
const path = require("node:path");
const { isAppUrl, isExternalUrl, shellPath, windowBounds } = require("./policy.cjs");
const { createSettingsStore } = require("../.desktop/settings-store.cjs");

app.setName("Implementation Harness");
// Overrides are useful for isolated smoke tests and separate development profiles.
if (process.env.IMPL_DESKTOP_USER_DATA) app.setPath("userData", path.resolve(process.env.IMPL_DESKTOP_USER_DATA));
if (!app.isPackaged && !process.env.IMPL_DESKTOP_USER_DATA) app.setPath("userData", path.join(app.getPath("appData"), "Implementation Harness Development"));

let window;
let backend;
let origin;
let quitting = false;
let exitApproved = false;
let quitDialogOpen = false;
let activeRuns = 0;
let preferences = {};
let settingsWindow;
let settingsDirty = false;
let settingsClosePending = false;
let restartRequested = false;
const notifications = new Map();
const userData = app.getPath("userData");
const preferencesFile = path.join(userData, "preferences.json");
const envFile = process.env.IMPL_ENV_FILE || (app.isPackaged ? path.join(userData, ".env") : path.resolve(__dirname, "../..", ".env"));
const logFile = path.join(userData, "logs", "server.log");
const dev = !app.isPackaged && process.argv.includes("--dev");
const settingsStore = createSettingsStore({ envFile, bundledPlugin: app.isPackaged });

function savePreferences() {
  try { writeFileSync(preferencesFile, JSON.stringify(preferences, null, 2)); }
  catch (error) { console.error("Impossible d'enregistrer les préférences :", error.message); }
}

function showWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function trusted(event, target = window) {
  return target && !target.isDestroyed() && event.sender === target.webContents
    && event.senderFrame === target.webContents.mainFrame && isAppUrl(event.senderFrame.url, origin);
}

function trustedSettings(event) {
  return trusted(event, settingsWindow) && new URL(event.senderFrame.url).pathname === "/settings";
}

function openExternal(url) {
  if (isExternalUrl(url)) void shell.openExternal(url).catch(console.error);
}

function secureWindow(target) {
  target.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: "deny" }; });
  target.webContents.on("will-navigate", (event, url) => { if (!isAppUrl(url, origin)) { event.preventDefault(); openExternal(url); } });
  target.webContents.on("will-redirect", (event, url) => { if (!isAppUrl(url, origin)) event.preventDefault(); });
  target.webContents.on("will-attach-webview", (event) => event.preventDefault());
}

async function confirmDiscardSettings() {
  if (!settingsDirty || !settingsWindow) return true;
  const { response } = await dialog.showMessageBox(settingsWindow, {
    type: "question", title: "Modifications non enregistrées", message: "Fermer sans enregistrer les réglages ?",
    buttons: ["Continuer à modifier", "Abandonner les modifications"], defaultId: 0, cancelId: 0,
  });
  if (response !== 1) return false;
  return true;
}

async function openSettings() {
  if (!origin || quitting) return;
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.show(); settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    width: 860, height: 800, minWidth: 660, minHeight: 600, title: "Réglages — Implementation Harness",
    parent: window, show: false, backgroundColor: "#f3f4ef",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false },
  });
  const target = settingsWindow;
  secureWindow(target);
  target.on("close", (event) => {
    if (!settingsDirty || quitting) return;
    event.preventDefault();
    if (settingsClosePending) return;
    settingsClosePending = true;
    void confirmDiscardSettings().then((discard) => { if (discard && !target.isDestroyed()) target.destroy(); })
      .finally(() => { settingsClosePending = false; });
  });
  target.on("closed", () => { settingsWindow = undefined; settingsDirty = false; });
  await target.loadURL(`${origin}/settings`);
  if (!target.isDestroyed()) { target.show(); target.focus(); }
}

function settingsSnapshot() { return { ...settingsStore.snapshot(), sound: preferences.sound === true }; }

function installNativeActions() {
  ipcMain.handle("desktop:select-directory", async (event) => {
    if (!trusted(event) && !trustedSettings(event)) throw new Error("Fenêtre non autorisée.");
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: "Choisir un dossier", properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("desktop:preferences", (event) => trusted(event) || trustedSettings(event) ? { sound: preferences.sound === true } : {});
  ipcMain.on("desktop:sound", (event, enabled) => {
    if ((!trusted(event) && !trustedSettings(event)) || typeof enabled !== "boolean") return;
    preferences.sound = enabled;
    savePreferences();
    for (const target of [window, settingsWindow]) if (target && !target.isDestroyed()) target.webContents.send("desktop:preferences-changed", { sound: enabled });
  });
  ipcMain.handle("desktop:open-settings", async (event) => { if (trusted(event)) await openSettings(); });
  ipcMain.handle("desktop:get-settings", (event) => {
    if (!trustedSettings(event)) throw new Error("Fenêtre non autorisée.");
    return settingsSnapshot();
  });
  ipcMain.handle("desktop:save-settings", (event, request) => {
    if (!trustedSettings(event)) throw new Error("Fenêtre non autorisée.");
    const result = settingsStore.save(request);
    if (result.ok) { settingsDirty = false; result.snapshot.sound = preferences.sound === true; }
    return result;
  });
  ipcMain.on("desktop:settings-dirty", (event, dirty) => { if (trustedSettings(event) && typeof dirty === "boolean") settingsDirty = dirty; });
  ipcMain.handle("desktop:restart", (event) => {
    if (!trustedSettings(event) || settingsDirty || quitting || quitDialogOpen) return;
    restartRequested = true;
    app.quit();
  });
  ipcMain.on("desktop:notify", (event, alert) => {
    if (!trusted(event) || window.isFocused() || !Notification.isSupported()) return;
    if (!alert || ![alert.title, alert.body, alert.tag, alert.runId].every((value) => typeof value === "string" && value.length <= 2000)) return;
    notifications.get(alert.tag)?.close();
    const notification = new Notification({ title: alert.title, body: alert.body, silent: true });
    notifications.set(alert.tag, notification);
    notification.on("click", () => { showWindow(); window.webContents.send("desktop:open-run", alert.runId); });
    notification.on("close", () => { if (notifications.get(alert.tag) === notification) notifications.delete(alert.tag); });
    notification.show();
  });
  ipcMain.on("desktop:status", (event, status) => {
    if (!trusted(event) || !status || ![status.active, status.attention].every((value) => Number.isInteger(value) && value >= 0 && value <= 1000)) return;
    activeRuns = status.active;
    app.setBadgeCount(status.attention);
    if (process.platform === "darwin") app.dock.setBadge(status.attention ? String(status.attention) : "");
    window.setProgressBar(activeRuns ? 2 : -1, { mode: status.attention ? "paused" : "indeterminate" });
  });
}

function installMenu() {
  const applicationMenu = {
    label: app.name,
    submenu: [
      { role: "about", label: "À propos d’Implementation Harness" },
      { type: "separator" },
      { label: "Afficher l’application", click: showWindow },
      { label: "Ouvrir les données locales", click: () => void shell.openPath(process.env.IMPL_DATA_DIR || (app.isPackaged ? path.join(userData, "data") : path.resolve(__dirname, "../data"))) },
      { label: "Réglages…", accelerator: "CmdOrCtrl+,", click: () => void openSettings().catch((error) => dialog.showErrorBox("Réglages indisponibles", error.message)) },
      { type: "separator" },
      ...(process.platform === "darwin" ? [{ role: "hide", label: "Masquer" }, { role: "hideOthers", label: "Masquer les autres" }, { type: "separator" }] : []),
      { role: "quit", label: "Quitter" },
    ],
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    applicationMenu,
    { label: "Fichier", submenu: [{ label: "Nouveau run", accelerator: "CmdOrCtrl+N", click: () => { showWindow(); window.webContents.send("desktop:new-run"); } }, { role: "close", label: "Fermer la fenêtre" }] },
    { label: "Édition", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "Affichage", submenu: [{ role: "reload", label: "Recharger" }, { role: "toggleDevTools", label: "Outils de développement" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" }] },
    { role: "windowMenu", label: "Fenêtre" },
  ]));
}

async function startBackend() {
  const environment = { ...process.env, PATH: await shellPath(process.env), NODE_ENV: dev ? "development" : "production", PORT: "0", IMPL_HOST: "127.0.0.1", IMPL_ENV_FILE: envFile };
  if (quitting) return;
  settingsStore.markApplied();
  delete environment.NODE_OPTIONS;
  delete environment.ELECTRON_RUN_AS_NODE;
  if (app.isPackaged) {
    environment.IMPL_DATA_DIR ??= path.join(userData, "data");
    environment.IMPL_BUNDLED_PLUGIN = "true";
    environment.IMPL_BUNDLED_PLUGIN_ROOT = path.join(process.resourcesPath, "plugin");
  }
  backend = utilityProcess.fork(path.join(__dirname, "../.desktop/server.mjs"), [], {
    cwd: app.getAppPath(), env: environment, stdio: "pipe", serviceName: "Implementation Harness Server",
  });
  let diagnostics = "";
  for (const stream of [backend.stdout, backend.stderr]) stream?.on("data", (chunk) => {
    const text = chunk.toString();
    diagnostics = (diagnostics + text).slice(-6000);
    try { appendFileSync(logFile, text); } catch { /* Diagnostics must not stop the server. */ }
    if (!app.isPackaged) process.stdout.write(text);
  });
  return new Promise((resolve, reject) => {
    let ready = false;
    const timeout = setTimeout(() => reject(new Error(`Le serveur n’a pas démarré à temps.\n${diagnostics}`)), 120_000);
    backend.on("message", (message) => {
      if (ready || message?.type !== "ready" || !/^http:\/\/127\.0\.0\.1:\d+$/.test(message.url)) return;
      ready = true;
      clearTimeout(timeout);
      resolve(message.url);
    });
    backend.once("exit", (code) => {
      clearTimeout(timeout);
      backend = undefined;
      if (quitting) return;
      const error = new Error(`Le serveur local s’est arrêté (code ${code}).\n${diagnostics}\nJournal : ${logFile}`);
      if (!ready) reject(error);
      else { dialog.showErrorBox("Implementation Harness", error.message); app.quit(); }
    });
  });
}

async function stopBackend() {
  if (!backend) return;
  const child = backend;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => { child.kill(); resolve(); }, 10_000);
    child.once("exit", () => { clearTimeout(timeout); resolve(); });
    child.postMessage("shutdown");
  });
}

async function start() {
  mkdirSync(path.dirname(logFile), { recursive: true });
  try { preferences = JSON.parse(readFileSync(preferencesFile, "utf8")); } catch { preferences = {}; }
  app.setAboutPanelOptions({ applicationName: app.name, applicationVersion: app.getVersion() });
  if (process.platform === "darwin" && !app.isPackaged) app.dock.setIcon(path.join(__dirname, "../.desktop/icon.png"));
  window = new BrowserWindow({
    width: 1440, height: 960, minWidth: 1000, minHeight: 700,
    ...windowBounds(preferences.bounds, screen.getAllDisplays()),
    title: app.name, backgroundColor: "#f5f5f0", show: false, icon: path.join(__dirname, "../.desktop/icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false },
  });
  const saveBounds = () => { preferences.bounds = window.getNormalBounds(); preferences.maximized = window.isMaximized(); savePreferences(); };
  window.on("resized", saveBounds);
  window.on("moved", saveBounds);
  window.on("close", (event) => {
    saveBounds();
    if (!exitApproved) { event.preventDefault(); if (process.platform === "darwin") window.hide(); else app.quit(); }
  });
  secureWindow(window);
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    if (isAppUrl(details.url, origin)) headers["Content-Security-Policy"] = [
      `default-src 'self'; script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:*; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'`,
    ];
    callback({ responseHeaders: headers });
  });
  installNativeActions();
  installMenu();
  await window.loadFile(path.join(__dirname, "loading.html"));
  if (preferences.maximized) window.maximize();
  window.show();
  origin = await startBackend();
  if (!quitting) await window.loadURL(origin);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", showWindow);
  app.on("activate", showWindow);
  app.on("before-quit", (event) => {
    if (exitApproved) return;
    event.preventDefault();
    if (quitting || quitDialogOpen) return;
    void (async () => {
      quitDialogOpen = true;
      if (!await confirmDiscardSettings()) { quitDialogOpen = false; restartRequested = false; return; }
      if (activeRuns > 0) {
        const { response } = await dialog.showMessageBox(settingsWindow ?? window, { type: "question", title: restartRequested ? "Redémarrer Implementation Harness ?" : "Quitter Implementation Harness ?", message: `${activeRuns} session(s) sont encore ouvertes.`, detail: "Cette action arrête les sessions. Les demandes en file seront reprises au prochain lancement.", buttons: ["Garder l’application ouverte", restartRequested ? "Arrêter et redémarrer" : "Arrêter et quitter"], defaultId: 0, cancelId: 0 });
        if (response !== 1) { quitDialogOpen = false; restartRequested = false; return; }
      }
      quitDialogOpen = false;
      quitting = true;
      await stopBackend();
      if (restartRequested) app.relaunch();
      exitApproved = true;
      app.quit();
    })();
  });
  process.on("SIGTERM", () => { activeRuns = 0; app.quit(); });
  process.on("SIGINT", () => { activeRuns = 0; app.quit(); });
  app.whenReady().then(start).catch((error) => { dialog.showErrorBox("Impossible de démarrer Implementation Harness", error.message); activeRuns = 0; app.quit(); });
}
