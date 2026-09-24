const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, listener) {
  const handler = (_event, value) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// Expose individual capabilities, never ipcRenderer, filesystem access or a shell.
contextBridge.exposeInMainWorld("desktop", {
  selectDirectory: () => ipcRenderer.invoke("desktop:select-directory"),
  notify: (alert) => ipcRenderer.send("desktop:notify", alert),
  updateStatus: (status) => ipcRenderer.send("desktop:status", status),
  getPreferences: () => ipcRenderer.invoke("desktop:preferences"),
  setSoundEnabled: (enabled) => ipcRenderer.send("desktop:sound", enabled),
  onOpenRun: (listener) => subscribe("desktop:open-run", listener),
  onNewRun: (listener) => subscribe("desktop:new-run", listener),
  openSettings: () => ipcRenderer.invoke("desktop:open-settings"),
  getSettings: () => ipcRenderer.invoke("desktop:get-settings"),
  saveSettings: (request) => ipcRenderer.invoke("desktop:save-settings", request),
  listPrompts: () => ipcRenderer.invoke("desktop:list-prompts"),
  readPrompt: (id) => ipcRenderer.invoke("desktop:read-prompt", id),
  savePrompt: (request) => ipcRenderer.invoke("desktop:save-prompt", request),
  resetPrompt: (request) => ipcRenderer.invoke("desktop:reset-prompt", request),
  setSettingsDirty: (dirty) => ipcRenderer.send("desktop:settings-dirty", dirty),
  restart: () => ipcRenderer.invoke("desktop:restart"),
  onPreferencesChanged: (listener) => subscribe("desktop:preferences-changed", listener),
});
