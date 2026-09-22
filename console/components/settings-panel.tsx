"use client";

import { ArrowClockwiseIcon, CheckIcon, FolderOpenIcon, GearSixIcon, SlidersHorizontalIcon, WarningCircleIcon, WrenchIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { SettingKey, SettingsSnapshot, SettingsValues } from "@/lib/desktop";

type Section = "general" | "runs" | "advanced";
const sections = [
  { id: "general" as const, label: "Général", icon: GearSixIcon, description: "Retrouvez vos projets et choisissez vos alertes." },
  { id: "runs" as const, label: "Exécutions", icon: SlidersHorizontalIcon, description: "Ajustez le fonctionnement des sessions Claude Code." },
  { id: "advanced" as const, label: "Avancé", icon: WrenchIcon, description: "Configurez le harnais et son scénario de démonstration." },
];
const permissionModes = [
  { value: "manual", label: "Demander avant chaque outil" },
  { value: "acceptEdits", label: "Accepter les modifications de fichiers" },
  { value: "auto", label: "Automatique (recommandé)" },
  { value: "dontAsk", label: "Ne rien demander" },
  { value: "bypassPermissions", label: "Sans aucune vérification" },
];
const button = "inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-white px-3.5 py-2 text-xs font-medium transition-colors hover:bg-[var(--paper)] active:translate-y-px disabled:cursor-default disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";
const primary = `${button} !border-[var(--accent)] !bg-[var(--accent)] !text-white hover:!bg-[#38644f]`;

function formValues(values: SettingsValues): SettingsValues {
  return { ...values, IMPL_SEARCH_ROOTS: values.IMPL_SEARCH_ROOTS.split(",").join("\n"), IMPL_DEMO_STEP_MS: String(Number(values.IMPL_DEMO_STEP_MS) / 1000) };
}

function storedValues(values: SettingsValues, original: SettingsValues): SettingsValues {
  const converted = { ...values, IMPL_SEARCH_ROOTS: values.IMPL_SEARCH_ROOTS.split("\n").map((root) => root.trim()).filter(Boolean).join(","), IMPL_DEMO_STEP_MS: values.IMPL_DEMO_STEP_MS.trim() ? String(Number((Number(values.IMPL_DEMO_STEP_MS) * 1000).toFixed(6))) : "" };
  const initial = formValues(original);
  // Keep untouched values verbatim, including values imposed by the shell.
  for (const key of Object.keys(values) as SettingKey[]) if (values[key] === initial[key]) converted[key] = original[key];
  return converted;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "Impossible d’accéder aux réglages.";
}

function Toggle({ id, label, help, checked, disabled, onChange }: { id: string; label: string; help: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <div className="grid grid-cols-[minmax(0,1fr)_44px] items-start gap-5">
    <div><label htmlFor={id} className="text-sm font-medium">{label}</label><p id={`${id}-help`} className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">{help}</p></div>
    <button id={id} type="button" role="switch" aria-checked={checked} aria-describedby={`${id}-help`} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={`mt-0.5 h-6 w-11 rounded-full p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-default disabled:opacity-40 ${checked ? "bg-[var(--accent)]" : "bg-[#c7cdc7]"}`}>
      <span className={`block size-5 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none ${checked ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  </div>;
}

export function SettingsPanel() {
  const [section, setSection] = useState<Section>("general");
  const [snapshot, setSnapshot] = useState<SettingsSnapshot>();
  const [draft, setDraft] = useState<SettingsValues>();
  const [errors, setErrors] = useState<Partial<Record<SettingKey, string>>>({});
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sound, setSound] = useState(false);
  const [desktop, setDesktop] = useState(true);
  const dirty = Boolean(snapshot && draft && JSON.stringify(storedValues(draft, snapshot.values)) !== JSON.stringify(snapshot.values));

  const apply = (next: SettingsSnapshot) => { setSnapshot(next); setDraft(formValues(next.values)); setSound(next.sound); setErrors({}); setError(undefined); setConflict(false); };

  const reload = async () => {
    setLoading(true);
    try { if (window.desktop) apply(await window.desktop.getSettings()); }
    catch (error) { setError(errorMessage(error)); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!window.desktop) { setDesktop(false); setLoading(false); return; }
    let disposed = false;
    void window.desktop.getSettings().then((next) => { if (!disposed) apply(next); })
      .catch((error) => { if (!disposed) setError(errorMessage(error)); }).finally(() => { if (!disposed) setLoading(false); });
    const unsubscribe = window.desktop.onPreferencesChanged(({ sound }) => { setSound(sound); setSnapshot((current) => current && { ...current, sound }); });
    return () => { disposed = true; unsubscribe(); };
  }, []);

  useEffect(() => { window.desktop?.setSettingsDirty(dirty); }, [dirty]);

  const edit = (key: SettingKey, value: string) => {
    setDraft((draft) => draft && { ...draft, [key]: value });
    setErrors((errors) => ({ ...errors, [key]: undefined }));
    setSaved(false);
  };

  const chooseDirectory = async (key: "IMPL_SEARCH_ROOTS" | "IMPL_PLUGIN_ROOT") => {
    try {
      const selected = await window.desktop?.selectDirectory();
      if (!selected || !draft) return;
      if (key === "IMPL_SEARCH_ROOTS") {
        if (selected.includes(",")) { setErrors((errors) => ({ ...errors, [key]: "Les noms de dossiers contenant une virgule ne sont pas pris en charge." })); return; }
        edit(key, [...new Set([...draft[key].split("\n").filter(Boolean), selected])].join("\n"));
      } else edit(key, selected);
    } catch (error) { setError(errorMessage(error)); }
  };

  const save = async () => {
    if (!snapshot || !draft || !window.desktop) return;
    setBusy(true); setError(undefined); setErrors({}); setConflict(false);
    try {
      const result = await window.desktop.saveSettings({ revision: snapshot.revision, values: storedValues(draft, snapshot.values) });
      if (result.ok) { apply(result.snapshot); setSaved(true); }
      else {
        setError(result.message); setConflict(Boolean(result.conflict)); setErrors(result.errors ?? {});
        const first = Object.keys(result.errors ?? {})[0];
        if (first) setSection(first === "IMPL_SEARCH_ROOTS" ? "general" : ["IMPL_PLUGIN_ROOT", "IMPL_DEMO_STEP_MS"].includes(first) ? "advanced" : "runs");
      }
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const locked = (key: SettingKey) => snapshot?.sources[key] === "environment";
  const disabled = (key: SettingKey) => busy || locked(key);
  const feedback = (key: SettingKey) => <>
    {locked(key) && <p className="mt-2 text-xs text-[var(--muted)]">Défini au lancement de l’application. Modifiez son environnement de lancement pour changer cette valeur.</p>}
    {errors[key] && <p id={`${key}-error`} role="alert" className="mt-2 text-xs text-red-700">{errors[key]}</p>}
    {!errors[key] && snapshot?.warnings[key]?.map((warning) => <p key={warning} className="mt-2 text-xs text-amber-800">{warning}</p>)}
  </>;

  return <main className="grid h-[100dvh] grid-rows-[minmax(0,1fr)_auto] bg-[var(--surface)]">
    <div className="grid min-h-0 grid-cols-[164px_minmax(0,1fr)]">
      <aside className="border-r border-[var(--line)] bg-[var(--paper)] px-3 py-7">
        <div className="mb-7 px-3"><p className="text-sm font-semibold tracking-tight">Implementation<br />Harness</p><p className="mt-2 text-[10px] uppercase tracking-[.16em] text-[var(--muted)]">Réglages</p></div>
        <nav aria-label="Catégories de réglages" className="space-y-1">
          {sections.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)} className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${section === id ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--muted)] hover:bg-white/60"}`}><Icon size={17} />{label}</button>)}
        </nav>
      </aside>
      <div className="min-w-0 overflow-y-auto px-7 py-8 sm:px-9">
        <header className="mb-8"><h1 className="text-2xl font-semibold tracking-tight">{sections.find((entry) => entry.id === section)?.label}</h1><p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">{sections.find((entry) => entry.id === section)?.description}</p></header>
        {!desktop && <p className="text-sm text-[var(--muted)]">Ces réglages sont disponibles dans l’application de bureau.</p>}
        {error && <div role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-800"><span className="flex gap-2"><WarningCircleIcon size={16} className="shrink-0" />{error}</span>{(conflict || !snapshot) && <button type="button" onClick={() => void reload()} className="mt-2 underline underline-offset-2">Recharger les réglages</button>}</div>}
        {loading ? <div aria-label="Chargement des réglages" aria-busy="true" className="space-y-6"><div className="h-4 w-44 rounded bg-[var(--line)]" /><div className="h-24 rounded-lg bg-[var(--paper)]" /><div className="h-16 rounded-lg bg-[var(--paper)]" /></div> : snapshot && draft && <form id="settings-form" noValidate onSubmit={(event) => { event.preventDefault(); void save(); }}>
          {section === "general" && <div className="space-y-8">
            <section>
              <label htmlFor="IMPL_SEARCH_ROOTS" className="text-sm font-medium">Dossiers de recherche</label>
              <p id="roots-help" className="mb-3 mt-1.5 text-xs leading-relaxed text-[var(--muted)]">Un dossier par ligne. Le harnais y cherche vos dépôts jusqu’à deux niveaux de profondeur.</p>
              <textarea id="IMPL_SEARCH_ROOTS" value={draft.IMPL_SEARCH_ROOTS} onChange={(event) => edit("IMPL_SEARCH_ROOTS", event.target.value)} disabled={disabled("IMPL_SEARCH_ROOTS")} rows={4} aria-invalid={Boolean(errors.IMPL_SEARCH_ROOTS)} aria-describedby="roots-help IMPL_SEARCH_ROOTS-error" className="field resize-y font-mono text-xs leading-relaxed disabled:opacity-60" spellCheck={false} />
              <button type="button" disabled={disabled("IMPL_SEARCH_ROOTS")} onClick={() => void chooseDirectory("IMPL_SEARCH_ROOTS")} className={`${button} mt-3`}><FolderOpenIcon size={16} />Ajouter un dossier…</button>
              {feedback("IMPL_SEARCH_ROOTS")}
            </section>
            <section className="border-t border-[var(--line)] pt-6"><Toggle id="sound" label="Son des alertes" help="Jouer un signal lorsqu’une décision est attendue ou qu’un run se termine. Appliqué immédiatement." checked={sound} onChange={(enabled) => { setSound(enabled); window.desktop?.setSoundEnabled(enabled); }} /></section>
          </div>}
          {section === "runs" && <div className="space-y-7">
            <section>
              <label htmlFor="IMPL_MAX_CONCURRENT_RUNS" className="text-sm font-medium">Runs en parallèle</label>
              <p id="runs-help" className="mb-3 mt-1.5 text-xs leading-relaxed text-[var(--muted)]">De 1 à 10 sessions. Les demandes supplémentaires attendent en file ; chaque dépôt reste limité à une session.</p>
              <input id="IMPL_MAX_CONCURRENT_RUNS" type="number" min={1} max={10} step={1} value={draft.IMPL_MAX_CONCURRENT_RUNS} onChange={(event) => edit("IMPL_MAX_CONCURRENT_RUNS", event.target.value)} disabled={disabled("IMPL_MAX_CONCURRENT_RUNS")} aria-invalid={Boolean(errors.IMPL_MAX_CONCURRENT_RUNS)} aria-describedby="runs-help IMPL_MAX_CONCURRENT_RUNS-error" className="field max-w-24 font-mono text-sm disabled:opacity-60" />
              {feedback("IMPL_MAX_CONCURRENT_RUNS")}
            </section>
            <section className="border-t border-[var(--line)] pt-6">
              <label htmlFor="IMPL_PERMISSION_MODE" className="text-sm font-medium">Permissions des sessions</label>
              <p id="permission-help" className="mb-3 mt-1.5 text-xs leading-relaxed text-[var(--muted)]">Ce que Claude Code s’autorise sans vous. « Demander avant chaque outil » arrête un run laissé sans surveillance dès la première question.</p>
              <select id="IMPL_PERMISSION_MODE" value={draft.IMPL_PERMISSION_MODE} onChange={(event) => edit("IMPL_PERMISSION_MODE", event.target.value)} disabled={disabled("IMPL_PERMISSION_MODE")} aria-invalid={Boolean(errors.IMPL_PERMISSION_MODE)} aria-describedby="permission-help IMPL_PERMISSION_MODE-error" className="field max-w-80 text-sm disabled:opacity-60">
                {permissionModes.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>
              {feedback("IMPL_PERMISSION_MODE")}
            </section>
            <section className="border-t border-[var(--line)] pt-6"><Toggle id="IMPL_REMOTE_CONTROL" label="Accès à distance" help="Reprendre le terminal d’un run sur claude.ai, depuis votre compte Claude Code." checked={draft.IMPL_REMOTE_CONTROL === "true"} disabled={disabled("IMPL_REMOTE_CONTROL")} onChange={(value) => edit("IMPL_REMOTE_CONTROL", String(value))} />{feedback("IMPL_REMOTE_CONTROL")}</section>
            <section className="border-t border-[var(--line)] pt-6"><Toggle id="IMPL_SELF_IMPROVEMENT_AUTORUN" label="Auto-audit" help="Lancer une analyse Claude Code après chaque workflow pour proposer des améliorations au harnais. Utilise votre quota Claude Code." checked={draft.IMPL_SELF_IMPROVEMENT_AUTORUN === "true"} disabled={disabled("IMPL_SELF_IMPROVEMENT_AUTORUN")} onChange={(value) => edit("IMPL_SELF_IMPROVEMENT_AUTORUN", String(value))} />{feedback("IMPL_SELF_IMPROVEMENT_AUTORUN")}<button type="button" onClick={() => setSection("advanced")} className="mt-3 text-xs text-[var(--accent)] underline underline-offset-3">Configurer le dépôt du harnais</button></section>
          </div>}
          {section === "advanced" && <div className="space-y-8">
            <section>
              <label htmlFor="IMPL_PLUGIN_ROOT" className="text-sm font-medium">Dépôt du harnais</label>
              <p id="plugin-help" className="mb-3 mt-1.5 text-xs leading-relaxed text-[var(--muted)]">Un checkout Git modifiable d’Implementation Harness est nécessaire à l’auto-audit. Laissez vide pour utiliser le plugin par défaut.</p>
              <input id="IMPL_PLUGIN_ROOT" value={draft.IMPL_PLUGIN_ROOT} onChange={(event) => edit("IMPL_PLUGIN_ROOT", event.target.value)} disabled={disabled("IMPL_PLUGIN_ROOT")} aria-invalid={Boolean(errors.IMPL_PLUGIN_ROOT)} aria-describedby="plugin-help IMPL_PLUGIN_ROOT-error" className="field font-mono text-xs disabled:opacity-60" placeholder="Plugin par défaut" spellCheck={false} />
              <button type="button" disabled={disabled("IMPL_PLUGIN_ROOT")} onClick={() => void chooseDirectory("IMPL_PLUGIN_ROOT")} className={`${button} mt-3`}><FolderOpenIcon size={16} />Choisir le dépôt…</button>
              {feedback("IMPL_PLUGIN_ROOT")}
            </section>
            <section className="border-t border-[var(--line)] pt-6">
              <label htmlFor="IMPL_DEMO_STEP_MS" className="text-sm font-medium">Durée d’une étape de démo</label>
              <p id="demo-help" className="mb-3 mt-1.5 text-xs leading-relaxed text-[var(--muted)]">Temps entre deux étapes du scénario simulé. Sans effet sur les vrais runs.</p>
              <div className="flex items-center gap-3"><input id="IMPL_DEMO_STEP_MS" type="number" min={0.001} max={3600} step="any" value={draft.IMPL_DEMO_STEP_MS} onChange={(event) => edit("IMPL_DEMO_STEP_MS", event.target.value)} disabled={disabled("IMPL_DEMO_STEP_MS")} aria-invalid={Boolean(errors.IMPL_DEMO_STEP_MS)} aria-describedby="demo-help IMPL_DEMO_STEP_MS-error" className="field max-w-24 font-mono text-sm disabled:opacity-60" /><span className="text-xs text-[var(--muted)]">secondes</span></div>
              {feedback("IMPL_DEMO_STEP_MS")}
            </section>
          </div>}
        </form>}
      </div>
    </div>
    <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--line)] bg-[var(--paper)] px-5 py-4">
      <div role="status" aria-live="polite" className="min-w-0 text-xs text-[var(--muted)]">
        {busy ? "Enregistrement…" : dirty ? "Modifications non enregistrées" : snapshot?.restartRequired ? <span className="flex items-center gap-2 text-[var(--accent)]"><CheckIcon size={15} />Enregistré. Un redémarrage est nécessaire.</span> : saved ? "Réglages enregistrés" : "Les changements de session s’appliquent au redémarrage."}
      </div>
      <div className="flex gap-2">
        {dirty && <button type="button" className={button} disabled={busy} onClick={() => { if (snapshot) apply(snapshot); setSaved(false); }}>Annuler les modifications</button>}
        {snapshot?.restartRequired && !dirty ? <button type="button" className={primary} onClick={() => void window.desktop?.restart().catch((error) => setError(errorMessage(error)))}><ArrowClockwiseIcon size={15} />Redémarrer l’application</button> : <button type="submit" form="settings-form" disabled={!dirty || busy || loading} className={primary}>Enregistrer</button>}
      </div>
    </footer>
  </main>;
}
