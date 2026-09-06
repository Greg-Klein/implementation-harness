"use client";

import { CodeIcon, StopIcon, TerminalWindowIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RepositoryOption, RepositoryResponse, RunState } from "@/lib/types";
import { ActivityPanel } from "./activity-panel";
import { LaunchForm } from "./launch-form";
import { PhaseRail } from "./phase-rail";
import { TerminalPanel, type TerminalHandle } from "./terminal-panel";

const initialState: RunState = { id: null, status: "idle", phase: 0, cwd: "", issueUrl: "", instruction: "", startedAt: null, endedAt: null, agents: [], activities: [], artifacts: [] };

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
  const demoStartedRef = useRef(false);
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
    const initialConnection = window.setTimeout(connect, 0);
    return () => { disposed = true; window.clearTimeout(initialConnection); if (retry) clearTimeout(retry); socketRef.current?.close(); };
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

  useEffect(() => {
    if (!connected || demoStartedRef.current || new URLSearchParams(window.location.search).get("demo") !== "1") return;
    demoStartedRef.current = true;
    terminalRef.current?.clear();
    send({ type: "demo.start" });
    window.history.replaceState({}, "", window.location.pathname);
  }, [connected, send]);

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
      <div className="mx-auto max-w-395 overflow-hidden rounded-6.5 border border-[var(--line)] bg-[var(--surface)] shadow-[0_26px_70px_-42px_rgba(38,50,43,.42)]">
        <header className="flex min-h-16 items-center justify-between border-b border-[var(--line)] px-5 md:px-7">
          <div className="flex items-center gap-3">
            <div className="grid size-8 place-items-center rounded-2.5 bg-[var(--ink)] text-white"><CodeIcon size={18} weight="bold" /></div>
            <div>
              <h1 className="text-[15px] font-semibold tracking-[-.02em]">Implementation Harness</h1>
              <p className="flex items-center gap-1.5 text-[10px] text-[var(--muted)]"><span className="hidden sm:inline">Claude Code workflow harness</span><span aria-hidden="true" className="hidden text-[var(--line)] sm:inline">/</span><span className="text-[#7c847f]">by Gregory Klein</span></p>
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
            <section className="min-h-135 border-y border-[var(--line)] bg-[var(--terminal)] lg:border-x lg:border-y-0">
              <div className="flex h-12 items-center justify-between border-b border-white/8 px-4 text-white">
                <div className="flex items-center gap-2 text-xs font-medium"><TerminalWindowIcon size={16} />Claude Code</div>
                {active && <button type="button" onClick={() => send({ type: "run.stop" })} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-white/55 transition hover:bg-white/8 hover:text-white active:scale-[.98]"><StopIcon size={12} weight="fill" /> Arrêter</button>}
              </div>
              <TerminalPanel ref={terminalRef} onInput={terminalInput} onResize={terminalResize} />
            </section>
            <ActivityPanel run={run} onFeedback={(body) => send({ type: "feedback.submit", body })} onAnswer={(answers) => send({ type: "question.answer", answers })} onSelfImprovementApprove={(worktreeName) => send({ type: "selfImprovement.approve", worktreeName })} onSelfImprovementReject={(worktreeName) => send({ type: "selfImprovement.reject", worktreeName })} />
          </div>
        )}
      </div>
    </main>
  );
}
