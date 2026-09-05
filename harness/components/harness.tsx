"use client";

import {
  ArrowRightIcon, CheckIcon, CircleNotchIcon, CodeIcon, FileTextIcon, FolderOpenIcon,
  GitBranchIcon, PlayIcon, RobotIcon, StopIcon, TerminalWindowIcon, WarningIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TerminalPanel, type TerminalHandle } from "./terminal-panel";

type Status = "idle" | "starting" | "running" | "attention" | "completed" | "failed";
type Agent = { id: string; name: string; status: "running" | "completed" | "failed"; startedAt: string; endedAt?: string };
type Activity = { id: string; at: string; kind: string; title: string; detail?: string };
type RunState = {
  id: string | null; status: Status; phase: number; cwd: string; issueUrl: string; instruction: string;
  startedAt: string | null; endedAt: string | null; agents: Agent[]; activities: Activity[]; artifacts: string[]; error?: string;
};
type RepositoryOption = { project: string; path: string; resolvedPath: string; exists: boolean };
type RepositoryResponse = {
  repositories: RepositoryOption[];
  detected: (RepositoryOption & { source: "env" | "git" }) | null;
};

const initialState: RunState = { id: null, status: "idle", phase: 0, cwd: "", issueUrl: "", instruction: "", startedAt: null, endedAt: null, agents: [], activities: [], artifacts: [] };
const phases = ["Lire le ticket", "Clarifier", "Créer la branche", "Planifier", "Implémenter", "Vérifier", "Revoir", "Ouvrir la MR", "Publier la revue", "Terminer"];

function statusLabel(status: Status) {
  if (status === "starting") return "Démarrage";
  if (status === "running") return "En cours";
  if (status === "attention") return "À toi de jouer";
  if (status === "completed") return "Terminé";
  if (status === "failed") return "Erreur";
  return "Disponible";
}
function elapsed(start: string, end?: string) {
  const milliseconds = new Date(end ?? Date.now()).getTime() - new Date(start).getTime();
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  return minutes ? `${minutes} min ${seconds.toString().padStart(2, "0")} s` : `${seconds} s`;
}

export function Harness() {
  const [run, setRun] = useState<RunState>(initialState);
  const [connected, setConnected] = useState(false);
  const [cwd, setCwd] = useState("");
  const [issueUrl, setIssueUrl] = useState("");
  const [instruction, setInstruction] = useState("");
  const [repositories, setRepositories] = useState<RepositoryOption[]>([]);
  const [detectedProject, setDetectedProject] = useState<string>();
  const [detectingProject, setDetectingProject] = useState(false);
  const cwdRef = useRef("");
  const socketRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<TerminalHandle>(null);

  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socketRef.current = socket;
      socket.onopen = () => { if (socketRef.current === socket) setConnected(true); };
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as { type: string; state?: RunState; data?: string };
        if (message.type === "state" && message.state) setRun(message.state);
        if (message.type === "terminal.output" && message.data) terminalRef.current?.write(message.data);
      };
      socket.onclose = () => {
        if (socketRef.current !== socket) return;
        setConnected(false);
        if (!disposed) retry = setTimeout(connect, 1200);
      };
    };
    connect();
    return () => { disposed = true; if (retry) clearTimeout(retry); socketRef.current?.close(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/repositories", { signal: controller.signal })
      .then((response) => response.json() as Promise<RepositoryResponse>)
      .then((result) => setRepositories(result.repositories))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!issueUrl.includes("/-/issues/") || cwdRef.current.trim()) {
      setDetectingProject(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setDetectingProject(true);
      fetch(`/api/repositories?issueUrl=${encodeURIComponent(issueUrl)}`, { signal: controller.signal })
        .then((response) => response.json() as Promise<RepositoryResponse>)
        .then((result) => {
          setRepositories(result.repositories);
          if (result.detected && !cwdRef.current.trim()) {
            cwdRef.current = result.detected.path;
            setCwd(result.detected.path);
            setDetectedProject(result.detected.project);
          }
        })
        .catch(() => undefined)
        .finally(() => { if (!controller.signal.aborted) setDetectingProject(false); });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [issueUrl]);

  const send = useCallback((message: object) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(message));
  }, []);
  const terminalInput = useCallback((data: string) => send({ type: "terminal.input", data }), [send]);
  const terminalResize = useCallback((cols: number, rows: number) => send({ type: "terminal.resize", cols, rows }), [send]);
  const changeCwd = useCallback((value: string, project?: string) => {
    cwdRef.current = value;
    setCwd(value);
    setDetectedProject(project);
  }, []);
  const start = () => { terminalRef.current?.clear(); send({ type: "run.start", cwd, issueUrl, instruction }); };
  const active = run.status === "starting" || run.status === "running" || run.status === "attention";
  const canStart = connected && !active && issueUrl.trim().length > 0;

  return (
    <main className="min-h-[100dvh] bg-[var(--paper)] p-3 md:p-5">
      <div className="mx-auto max-w-[1580px] overflow-hidden rounded-[26px] border border-[var(--line)] bg-[var(--surface)] shadow-[0_26px_70px_-42px_rgba(38,50,43,.42)]">
        <header className="flex min-h-16 items-center justify-between border-b border-[var(--line)] px-5 md:px-7">
          <div className="flex items-center gap-3">
            <div className="grid size-8 place-items-center rounded-[10px] bg-[var(--ink)] text-white"><CodeIcon size={18} weight="bold" /></div>
            <div>
              <h1 className="text-[15px] font-semibold tracking-[-.02em]">X-Implement</h1>
              <p className="flex items-center gap-1.5 text-[10px] text-[var(--muted)]"><span className="hidden sm:inline">Claude Code workflow harness</span><span aria-hidden="true" className="hidden text-[var(--line)] sm:inline">/</span><span className="text-[#7c847f]">Gregory Klein</span></p>
            </div>
          </div>
          <div title="Connexion temps réel entre cette page et le serveur local du harnais" className="flex items-center gap-2 text-xs text-[var(--muted)]">
            <span className={`size-1.5 rounded-full ${connected ? "bg-[var(--accent)] status-breathe" : "bg-red-500"}`} />
            <span>Serveur local</span><span aria-hidden="true" className="text-[var(--line)]">·</span><span className={connected ? "text-[var(--accent)]" : "text-red-600"}>{connected ? "connecté" : "reconnexion…"}</span>
            {run.status !== "idle" && !active && <button type="button" onClick={() => send({ type: "run.reset" })} className="ml-3 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--ink)] transition hover:bg-white active:translate-y-px">Nouveau run</button>}
          </div>
        </header>

        {run.status === "idle" ? (
          <LaunchForm cwd={cwd} setCwd={changeCwd} issueUrl={issueUrl} setIssueUrl={setIssueUrl} instruction={instruction} setInstruction={setInstruction} repositories={repositories} detectedProject={detectedProject} detectingProject={detectingProject} canStart={canStart} onStart={start} />
        ) : (
          <div className="grid min-h-[calc(100dvh-106px)] grid-cols-1 lg:grid-cols-[236px_minmax(0,1fr)_320px]">
            <PhaseRail run={run} />
            <section className="min-h-[540px] border-y border-[var(--line)] bg-[var(--terminal)] lg:border-x lg:border-y-0">
              <div className="flex h-12 items-center justify-between border-b border-white/8 px-4 text-white">
                <div className="flex items-center gap-2 text-xs font-medium"><TerminalWindowIcon size={16} />Claude Code</div>
                {active && <button type="button" onClick={() => send({ type: "run.stop" })} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-white/55 transition hover:bg-white/8 hover:text-white active:scale-[.98]"><StopIcon size={12} weight="fill" /> Arrêter</button>}
              </div>
              <TerminalPanel ref={terminalRef} onInput={terminalInput} onResize={terminalResize} />
            </section>
            <ActivityPanel run={run} onFeedback={(body) => send({ type: "feedback.submit", body })} />
          </div>
        )}
      </div>
    </main>
  );
}

function LaunchForm({ cwd, setCwd, issueUrl, setIssueUrl, instruction, setInstruction, repositories, detectedProject, detectingProject, canStart, onStart }: {
  cwd: string; setCwd: (value: string, project?: string) => void; issueUrl: string; setIssueUrl: (value: string) => void;
  instruction: string; setInstruction: (value: string) => void; repositories: RepositoryOption[]; detectedProject?: string;
  detectingProject: boolean; canStart: boolean; onStart: () => void;
}) {
  return (
    <section className="grid min-h-[calc(100dvh-106px)] grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">
      <div className="flex flex-col justify-between px-6 py-10 md:px-12 md:py-14 lg:px-[7vw]">
        <div className="reveal">
          <p className="mb-8 font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--accent)]">Nouvelle exécution</p>
          <h2 className="max-w-[760px] text-4xl font-medium leading-[.98] tracking-[-.055em] md:text-6xl">Du ticket à la MR,<span className="block text-[var(--muted)]">sans perdre le fil.</span></h2>
          <p className="mt-7 max-w-[52ch] text-sm leading-6 text-[var(--muted)] md:text-base">Lance ton workflow Claude Code habituel. Les agents, les artefacts et les revues remontent ici pendant que le terminal reste pleinement interactif.</p>
        </div>
        <div className="mt-16 flex items-center gap-8 border-t border-[var(--line)] pt-5 text-xs text-[var(--muted)]">
          <span className="flex items-center gap-2"><RobotIcon size={15} /> 6 agents spécialisés</span>
          <span className="flex items-center gap-2"><FileTextIcon size={15} /> Historique local</span>
        </div>
      </div>

      <div className="flex items-center border-t border-[var(--line)] bg-[#eceee8] p-5 md:p-10 lg:border-l lg:border-t-0">
        <form className="w-full rounded-[22px] border border-white/70 bg-[var(--surface)] p-5 shadow-[0_18px_45px_-28px_rgba(30,42,35,.35),inset_0_1px_0_rgba(255,255,255,.8)] md:p-7" onSubmit={(event) => { event.preventDefault(); if (canStart) onStart(); }}>
          <div className="mb-7 flex items-start justify-between">
            <div><h3 className="text-lg font-semibold tracking-[-.025em]">Configurer le run</h3><p className="mt-1 text-xs text-[var(--muted)]">La commande sera exécutée dans le projet choisi.</p></div>
            <div className="grid size-9 place-items-center rounded-full border border-[var(--line)] text-[var(--muted)]"><GitBranchIcon size={16} /></div>
          </div>
          <Field label="Ticket GitLab"><input type="url" value={issueUrl} onChange={(event) => setIssueUrl(event.target.value)} placeholder="https://gitlab.com/…/-/issues/217" className="field text-sm" /></Field>
          <RepositoryPicker value={cwd} onChange={setCwd} repositories={repositories} detectedProject={detectedProject} detecting={detectingProject} />
          <label className="block"><span className="mb-2 block text-xs font-medium">Instruction particulière <span className="font-normal text-[var(--muted)]">· facultatif</span></span><textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Desktop uniquement, ne pas toucher au tracking…" rows={3} className="field resize-none text-sm leading-5" /></label>
          <button type="submit" disabled={!canStart} className="mt-7 flex w-full items-center justify-between rounded-[11px] bg-[var(--ink)] px-4 py-3.5 text-sm font-medium text-white transition hover:bg-[#2a322e] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35">
            <span className="flex items-center gap-2"><PlayIcon size={15} weight="fill" /> Lancer x-implement</span><ArrowRightIcon size={16} />
          </button>
        </form>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="mb-5 block"><span className="mb-2 block text-xs font-medium">{label}</span>{children}</label>;
}

function RepositoryPicker({ value, onChange, repositories, detectedProject, detecting }: {
  value: string;
  onChange: (value: string, project?: string) => void;
  repositories: RepositoryOption[];
  detectedProject?: string;
  detecting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const query = value.trim().toLocaleLowerCase("fr");
  const suggestions = useMemo(() => {
    if (!query) return [];
    return repositories.filter((repository) =>
      `${repository.project} ${repository.path} ${repository.resolvedPath}`.toLocaleLowerCase("fr").includes(query),
    ).slice(0, 7);
  }, [query, repositories]);
  const listOpen = open && query.length > 0;

  useEffect(() => setActiveIndex(0), [query]);

  const select = (repository: RepositoryOption) => {
    onChange(repository.path, repository.project);
    setOpen(false);
  };

  return (
    <div className="relative mb-5">
      <div className="mb-2 flex min-h-4 items-center justify-between gap-3">
        <label htmlFor="project-directory" className="text-xs font-medium">Répertoire du projet <span className="font-normal text-[var(--muted)]">· facultatif</span></label>
        <span className="truncate text-right font-mono text-[9px] text-[var(--accent)]">
          {detecting ? "Détection…" : detectedProject ? `Projet · ${detectedProject}` : ""}
        </span>
      </div>
      <div className="relative">
        <FolderOpenIcon aria-hidden="true" size={15} className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-[var(--muted)]" />
        <input
          id="project-directory"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={listOpen}
          aria-controls="repository-suggestions"
          aria-activedescendant={listOpen && suggestions[activeIndex] ? `repository-${activeIndex}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(event) => { onChange(event.target.value); setOpen(true); }}
          onKeyDown={(event) => {
            if (!listOpen || suggestions.length === 0) return;
            if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => (index + 1) % suggestions.length); }
            if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length); }
            if (event.key === "Enter") { event.preventDefault(); select(suggestions[activeIndex]); }
            if (event.key === "Escape") setOpen(false);
          }}
          placeholder="Détecté depuis le ticket, ou commence à taper…"
          className="field !pl-10 !pr-9 font-mono text-xs"
        />
        {detectedProject && <CheckIcon aria-hidden="true" size={14} weight="bold" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--accent)]" />}
      </div>
      {listOpen && (
        <div id="repository-suggestions" role="listbox" className="absolute left-0 right-0 top-[calc(100%+7px)] z-30 overflow-hidden rounded-[11px] border border-[var(--line)] bg-white p-1.5 shadow-[0_18px_45px_-22px_rgba(28,33,31,.38)]">
          {suggestions.length > 0 ? suggestions.map((repository, index) => (
            <button
              key={`${repository.project}-${repository.path}`}
              id={`repository-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              type="button"
              onMouseDown={(event) => { event.preventDefault(); select(repository); }}
              onMouseEnter={() => setActiveIndex(index)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${index === activeIndex ? "bg-[var(--accent-soft)]" : "hover:bg-[#f4f5f1]"}`}
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md border border-[var(--line)] bg-white text-[var(--accent)]"><GitBranchIcon size={13} /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{repository.project}</span><span className="mt-0.5 block truncate font-mono text-[9px] text-[var(--muted)]">{repository.path}</span></span>
              {!repository.exists && <span className="shrink-0 text-[9px] text-amber-700">Introuvable</span>}
            </button>
          )) : <p className="px-3 py-3 text-[11px] text-[var(--muted)]">Aucun dépôt déclaré ne correspond.</p>}
        </div>
      )}
    </div>
  );
}

function PhaseRail({ run }: { run: RunState }) {
  return (
    <aside className="p-5">
      <div className="mb-6 flex items-center justify-between"><span className="text-xs font-semibold">Progression</span><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${run.status === "attention" ? "bg-amber-100 text-amber-800" : "bg-[var(--accent-soft)] text-[var(--accent)]"}`}>{statusLabel(run.status)}</span></div>
      <ol>{phases.map((phase, index) => {
        const number = index + 1; const done = number < run.phase || run.phase === 10; const current = number === run.phase && run.phase < 10;
        return <li key={phase} className="relative flex min-h-10 gap-3 text-xs">
          {index < phases.length - 1 && <span className={`absolute left-[9px] top-5 h-5 w-px ${done ? "bg-[var(--accent)]" : "bg-[var(--line)]"}`} />}
          <span className={`relative grid size-5 shrink-0 place-items-center rounded-full border font-mono text-[9px] ${done ? "border-[var(--accent)] bg-[var(--accent)] text-white" : current ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--line)] bg-[var(--surface)] text-[var(--muted)]"}`}>{done ? <CheckIcon size={10} weight="bold" /> : number}</span>
          <span className={`pt-0.5 ${current ? "font-semibold text-[var(--ink)]" : done ? "text-[var(--ink)]" : "text-[var(--muted)]"}`}>{phase}</span>
        </li>;
      })}</ol>
      <div className="mt-6 border-t border-[var(--line)] pt-4"><p className="truncate font-mono text-[10px] text-[var(--muted)]" title={run.cwd}>{run.cwd}</p>{run.startedAt && <p className="mt-2 font-mono text-[10px] text-[var(--muted)]">{elapsed(run.startedAt, run.endedAt ?? undefined)}</p>}</div>
    </aside>
  );
}

function ActivityPanel({ run, onFeedback }: { run: RunState; onFeedback: (body: string) => void }) {
  const runningAgents = run.agents.filter((agent) => agent.status === "running");
  const [feedback, setFeedback] = useState("");
  const [queued, setQueued] = useState(false);
  const submitFeedback = () => {
    if (!feedback.trim()) return;
    onFeedback(feedback);
    setFeedback("");
    setQueued(true);
  };
  return (
    <aside className="flex min-h-0 flex-col bg-[#f7f8f4]">
      {run.error && <div className="m-4 flex gap-2.5 rounded-[10px] border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800"><WarningIcon className="mt-0.5 shrink-0" size={15} /> {run.error}</div>}
      <section className="border-b border-[var(--line)] p-5">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-xs font-semibold">Agents</h2><span className="font-mono text-[10px] text-[var(--muted)]">{runningAgents.length} actif{runningAgents.length > 1 ? "s" : ""}</span></div>
        {run.agents.length === 0 ? <div className="flex items-center gap-3 py-2 text-xs text-[var(--muted)]"><div className="grid size-8 place-items-center rounded-full border border-dashed border-[var(--line)]"><RobotIcon size={14} /></div>En attente de délégation</div> :
          <div className="space-y-2.5">{run.agents.slice(0, 5).map((agent, index) => <div key={agent.id} className="reveal flex items-center gap-3" style={{ animationDelay: `${index * 55}ms` }}>
            <div className="grid size-8 place-items-center rounded-full bg-white text-[var(--accent)] shadow-[inset_0_0_0_1px_var(--line)]">{agent.status === "running" ? <CircleNotchIcon className="animate-spin" size={14} /> : <CheckIcon size={13} weight="bold" />}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{agent.name}</p><p className="mt-0.5 font-mono text-[9px] text-[var(--muted)]">{elapsed(agent.startedAt, agent.endedAt)}</p></div>
          </div>)}</div>}
      </section>
      <section className="min-h-0 flex-1 p-5">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-xs font-semibold">Activité</h2><span className="font-mono text-[10px] text-[var(--muted)]">LIVE</span></div>
        <div className="scrollbar-thin max-h-[38vh] space-y-4 overflow-y-auto pr-1 lg:max-h-[calc(100dvh-410px)]">{run.activities.map((item, index) => <div key={item.id} className="reveal grid grid-cols-[8px_1fr] gap-2.5" style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}>
          <span className={`mt-1.5 size-1.5 rounded-full ${item.kind === "attention" ? "bg-amber-500" : item.kind === "artifact" ? "bg-[var(--accent)]" : "bg-[#aeb5b0]"}`} />
          <div className="min-w-0"><p className="text-[11px] font-medium leading-4">{item.title}</p>{item.detail && <p className="mt-0.5 line-clamp-2 font-mono text-[9px] leading-4 text-[var(--muted)]">{item.detail}</p>}<p className="mt-1 font-mono text-[9px] text-[#9aa19c]">{new Date(item.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p></div>
        </div>)}</div>
      </section>
      <section className="border-t border-[var(--line)] p-5">
        <div className="flex items-center justify-between text-xs"><span className="flex items-center gap-2 font-medium"><FileTextIcon size={14} /> Artefacts archivés</span><span className="font-mono text-[11px] text-[var(--accent)]">{run.artifacts.length}</span></div>
        {(run.status === "completed" || run.status === "failed") && <div className="mt-4 border-t border-[var(--line)] pt-4">
          <label className="text-[11px] font-semibold" htmlFor="run-feedback">Faire progresser le harnais</label>
          <textarea id="run-feedback" value={feedback} onChange={(event) => { setFeedback(event.target.value); setQueued(false); }} rows={2} placeholder="Ce qui a ralenti, manqué ou mal fonctionné…" className="field mt-2 resize-none text-[11px] leading-4" />
          <button type="button" disabled={!feedback.trim()} onClick={submitFeedback} className="mt-2 w-full rounded-lg bg-[var(--accent)] px-3 py-2 text-[11px] font-semibold text-white transition hover:opacity-90 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35">Ajouter à la boucle RSI</button>
          {queued && <p className="mt-2 text-[10px] leading-4 text-[var(--accent)]">Retour enregistré. Lance <code>ximpl improve</code> pour produire l’amélioration.</p>}
        </div>}
      </section>
    </aside>
  );
}
