import type { RunAlert } from "./notifications";

export type SettingKey = "IMPL_SEARCH_ROOTS" | "IMPL_MAX_CONCURRENT_RUNS" | "IMPL_REMOTE_CONTROL" | "IMPL_SELF_IMPROVEMENT_AUTORUN" | "IMPL_DEMO_STEP_MS" | "IMPL_PLUGIN_ROOT";
export type SettingsValues = Record<SettingKey, string>;
export interface SettingsSnapshot {
  values: SettingsValues;
  sources: Record<SettingKey, "environment" | "file" | "default">;
  warnings: Partial<Record<SettingKey, string[]>>;
  revision: string;
  restartRequired: boolean;
  sound: boolean;
}
export type SettingsSaveResult = { ok: true; snapshot: SettingsSnapshot } | { ok: false; message: string; errors?: Partial<Record<SettingKey, string>>; conflict?: boolean };

export interface DesktopBridge {
  selectDirectory(): Promise<string | null>;
  notify(alert: RunAlert): void;
  updateStatus(status: { active: number; attention: number }): void;
  getPreferences(): Promise<{ sound: boolean }>;
  setSoundEnabled(enabled: boolean): void;
  onOpenRun(listener: (runId: string) => void): () => void;
  onNewRun(listener: () => void): () => void;
  openSettings(): Promise<void>;
  getSettings(): Promise<SettingsSnapshot>;
  saveSettings(request: { revision: string; values: SettingsValues }): Promise<SettingsSaveResult>;
  setSettingsDirty(dirty: boolean): void;
  restart(): Promise<void>;
  onPreferencesChanged(listener: (preferences: { sound: boolean }) => void): () => void;
}

declare global {
  interface Window { desktop?: DesktopBridge }
}
