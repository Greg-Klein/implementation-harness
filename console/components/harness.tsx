"use client";

import { ChatCircleDotsIcon, CodeIcon, SpeakerHighIcon, SpeakerSlashIcon, StopIcon, TerminalWindowIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { documentTitle, faviconColor, faviconDataUri, runAlert } from "@/lib/notifications";
import { isWriting, runInProgress } from "@/lib/run-state";
import { isSoundEnabled, playCue, setSoundEnabled, unlockSound } from "@/lib/sound";
import type { PendingImprovementsResponse, PendingSelfImprovementReview, RepositoryOption, RepositoryResponse, RunState } from "@/lib/types";
import { ActivityPanel } from "./activity-panel";
import { ConversationPanel } from "./conversation-panel";
import { LaunchForm } from "./launch-form";
import { PhaseRail } from "./phase-rail";
import { SelfImprovementReviewPanel } from "./self-improvement-review-panel";
import { TerminalPanel, type TerminalHandle } from "./terminal-panel";

const TICKET_URL = /\/-\/(?:issues|work_items)\/\d+/;
// Independent of any run, so a slow improvement agent is caught however long it takes.
const PENDING_IMPROVEMENTS_POLL_MS = 20_000;

const initialState: RunState = { id: null, status: "idle", phase: 0, cwd: "", issueUrl: "", instruction: "", startedAt: null, endedAt: null, agents: [], activities: [], messages: [], artifacts: [] };

export function Harness() {
  const [run, setRun] = useState<RunState>(initialState);
  const [connected, setConnected] = useState(false);
  const [cwd, setCwd] = useState("");
  const [issueUrl, setIssueUrl] = useState("");
  const [tab, setTab] = useState<"conversation" | "terminal">("conversation");
  const [instruction, setInstruction] = useState("");
  const [repositories, setRepositories] = useState<RepositoryOption[]>([]);
  const [pendingImprovements, setPendingImprovements] = useState<PendingSelfImprovementReview[]>([]);
  const [detectedProject, setDetectedProject] = useState<string>();
  const [detectingProject, setDetectingProject] = useState(false);
  // Read after mount: the server renders this page and has no localStorage.
  const [sound, setSound] = useState(false);
  const [writing, setWriting] = useState(false);
  const cwdRef = useRef("");
  const lastOutputRef = useRef(0);
  const demoStartedRef = useRef(false);
  const socketRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<TerminalHandle>(null);
  const previousRunRef = useRef<RunState | null>(null);

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
        if (message.type === "terminal.output" && message.data) {
          // Output arrives in bursts, so it stays out of the React state: only
          // the interval below turns it into a boolean, and only when it flips.
          lastOutputRef.current = Date.now();
          terminalRef.current?.write(message.data);
        }
      };
      socket.onclose = () => {
        if (socketRef.current !== socket) return;
        setConnected(false);
        if (!disposed) retry = setTimeout(connect, 1200);
      };
    };
    const initialConnection = window.setTimeout(connect, 0);
    return () => { disposed = true; window.clearTimeout(initialConnection); if (retry) clearTimeout(retry); socketRef.current?.close(); };
  }, []);

  const refreshPendingImprovements = useCallback(() => {
    fetch("/api/self-improvement/pending")
      .then((response) => response.json() as Promise<PendingImprovementsResponse>)
      .then((result) => setPendingImprovements(result.items ?? []))
      .catch(() => undefined);
  }, []);

  // Independent of the current run: a worktree the improvement loop produced hours ago,
  // or while no run was active, must surface just the same. Polled, never watched: the
  // list is always exactly what git has right now, however long a background agent took.
  useEffect(() => {
    refreshPendingImprovements();
    const timer = window.setInterval(refreshPendingImprovements, PENDING_IMPROVEMENTS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [refreshPendingImprovements]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/repositories", { signal: controller.signal })
      .then((response) => response.json() as Promise<RepositoryResponse>)
      .then((result) => setRepositories(result.repositories))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!TICKET_URL.test(issueUrl) || cwdRef.current.trim()) {
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

  // A notification is only useful for what the window cannot show: the tab keeps
  // the state readable when it is visible, the system notification calls back
  // when it is not.
  useEffect(() => {
    const previous = previousRunRef.current;
    previousRunRef.current = run;
    document.title = documentTitle(run);
    const icon = document.querySelector<HTMLLinkElement>("link[rel='icon']") ?? document.head.appendChild(Object.assign(document.createElement("link"), { rel: "icon" }));
    icon.href = faviconDataUri(faviconColor(run));
    const alert = runAlert(previous, run);
    if (!alert) return;
    // The sound is not gated on visibility: a window sitting behind the editor
    // is not hidden, and that is exactly when the user needs to be called back.
    playCue(alert.cue);
    if (!document.hidden || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    new Notification(alert.title, { body: alert.body, tag: alert.tag });
  }, [run]);

  // Nothing here can make the dialogue arrive sooner, so it says that it is
  // late: the flow of terminal output is the only live proof that the last
  // message shown is not the last one Claude wrote.
  useEffect(() => {
    if (!runInProgress(run.status)) { setWriting(false); return; }
    const timer = window.setInterval(() => setWriting(isWriting(run.status, lastOutputRef.current, Date.now())), 500);
    return () => window.clearInterval(timer);
  }, [run.status]);

  // A page may only emit sound after a real interaction. Starting a run is the
  // usual one, but the demonstration starts from a URL and would stay mute, so
  // any first gesture on the page opens the channel.
  useEffect(() => {
    setSound(isSoundEnabled());
    const unlock = () => unlockSound();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  /** Turning it on plays the cue straight away, so the setting proves itself. */
  const toggleSound = () => {
    const enabled = !sound;
    setSoundEnabled(enabled);
    setSound(enabled);
    if (enabled) { unlockSound(); playCue("attention"); }
  };

  const send = useCallback((message: object) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(message));
  }, []);

  useEffect(() => {
    if (!connected || demoStartedRef.current || new URLSearchParams(window.location.search).get("demo") !== "1") return;
    demoStartedRef.current = true;
    terminalRef.current?.clear();
    send({ type: "demo.start" });
    window.history.replaceState({}, "", window.location.pathname);
  }, [connected, send]);

  // The panel drops the card immediately for a responsive click; the next poll
  // reconciles from the server, which stays the source of truth either way.
  const approveImprovement = useCallback((worktreeName: string) => {
    setPendingImprovements((items) => items.filter((item) => item.worktreeName !== worktreeName));
    send({ type: "selfImprovement.approve", worktreeName });
  }, [send]);
  const rejectImprovement = useCallback((worktreeName: string) => {
    setPendingImprovements((items) => items.filter((item) => item.worktreeName !== worktreeName));
    send({ type: "selfImprovement.reject", worktreeName });
  }, [send]);

  const terminalInput = useCallback((data: string) => send({ type: "terminal.input", data }), [send]);
  const terminalResize = useCallback((cols: number, rows: number) => send({ type: "terminal.resize", cols, rows }), [send]);
  const changeCwd = useCallback((value: string, project?: string) => {
    cwdRef.current = value;
    setCwd(value);
    setDetectedProject(project);
  }, []);
  // Both channels need this gesture: a browser only prompts for notifications
  // and only lets a page emit sound from a real interaction. Starting a run is
  // also the moment the user says they are about to walk away.
  const start = () => {
    terminalRef.current?.clear();
    unlockSound();
    if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
    send({ type: "run.start", cwd, issueUrl, instruction });
  };
  const active = runInProgress(run.status);
  const canStart = connected && !active && issueUrl.trim().length > 0;

  return (
    <main className="min-h-[100dvh] bg-[var(--paper)] p-3 md:p-5">
      <div className="mx-auto max-w-395 overflow-hidden rounded-6.5 border border-[var(--line)] bg-[var(--surface)] shadow-[0_26px_70px_-42px_rgba(38,50,43,.42)]">
        <header className="flex min-h-16 items-center justify-between border-b border-[var(--line)] px-5 md:px-7">
          <div className="flex items-center gap-3">
            <div className="grid size-8 place-items-center rounded-2.5 bg-[var(--ink)] text-white"><CodeIcon size={18} weight="bold" /></div>
            <div>
              <h1 className="text-[15px] font-semibold tracking-[-.02em]">Implementation Harness</h1>
              <p className="flex items-center gap-1.5 text-[10px] text-[var(--muted)]"><span className="hidden sm:inline">Claude Code workflow harness</span><span aria-hidden="true" className="hidden text-[var(--line)] sm:inline">/</span><span className="text-[#7c847f]">by Gregory Klein</span></p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
            <button type="button" role="switch" aria-checked={sound} aria-label="Son des alertes" onClick={toggleSound} title={sound ? "Son des alertes activé, cliquer pour couper" : "Son des alertes coupé, cliquer pour activer"} className={`mr-1 grid size-7 place-items-center rounded-lg border border-[var(--line)] transition hover:bg-white active:translate-y-px ${sound ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}>
              {sound ? <SpeakerHighIcon size={14} /> : <SpeakerSlashIcon size={14} />}
            </button>
            <span title="Connexion temps réel entre cette page et le serveur local du harnais" className={`size-1.5 rounded-full ${connected ? "bg-[var(--accent)] status-breathe" : "bg-red-500"}`} />
            <span>Serveur local</span><span aria-hidden="true" className="text-[var(--line)]">·</span><span className={connected ? "text-[var(--accent)]" : "text-red-600"}>{connected ? "connecté" : "reconnexion…"}</span>
            {run.status !== "idle" && !active && <button type="button" disabled={!connected} onClick={() => send({ type: "run.reset" })} className="ml-3 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--ink)] transition hover:bg-white active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40">Nouveau run</button>}
          </div>
        </header>

        <SelfImprovementReviewPanel reviews={pendingImprovements} onApprove={approveImprovement} onReject={rejectImprovement} />

        {run.status === "idle" ? (
          <LaunchForm cwd={cwd} setCwd={changeCwd} issueUrl={issueUrl} setIssueUrl={setIssueUrl} instruction={instruction} setInstruction={setInstruction} repositories={repositories} detectedProject={detectedProject} detectingProject={detectingProject} canStart={canStart} onStart={start} />
        ) : (
          <div className="grid min-h-[calc(100dvh-106px)] grid-cols-1 lg:h-[calc(100dvh-106px)] lg:grid-cols-[236px_minmax(0,1fr)_320px]">
            <PhaseRail run={run} />
            <section className="flex min-h-135 flex-col border-y border-[var(--line)] bg-[var(--surface)] lg:border-x lg:border-y-0">
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--line)] px-4">
                <div role="tablist" aria-label="Vue de la session" className="flex items-center gap-0.5 rounded-full border border-[var(--line)] bg-[#f1f3ee] p-0.5">
                  {([["conversation", "Conversation"], ["terminal", "Terminal"]] as const).map(([value, label]) => (
                    <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium transition ${tab === value ? "bg-[var(--ink)] text-white" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>
                      {value === "conversation" ? <ChatCircleDotsIcon size={13} /> : <TerminalWindowIcon size={13} />}{label}
                    </button>
                  ))}
                </div>
                {active && <button type="button" disabled={!connected} onClick={() => send({ type: "run.stop" })} className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--ink)] transition hover:bg-white active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"><StopIcon size={12} weight="fill" /> Arrêter</button>}
              </div>
              <div className={tab === "conversation" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
                <ConversationPanel messages={run.messages} writing={writing} canSend={active && connected} onSend={(text) => send({ type: "instruction.send", text })} />
              </div>
              <div className={tab === "terminal" ? "min-h-0 flex-1 bg-[var(--terminal)]" : "hidden"}>
                <TerminalPanel ref={terminalRef} onInput={terminalInput} onResize={terminalResize} />
              </div>
            </section>
            <ActivityPanel run={run} onFeedback={(body) => send({ type: "feedback.submit", body })} onAnswer={(answers) => send({ type: "question.answer", answers })} />
          </div>
        )}
      </div>
    </main>
  );
}
