"use client";

import { ArrowRightIcon, CheckIcon, CircleNotchIcon, FileTextIcon, RobotIcon, WarningIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { activeAgents, isDemoRun } from "@/lib/run-state";
import type { RunState } from "@/lib/types";
import { DocumentViewer } from "./document-viewer";
import { QuestionPanel } from "./question-panel";
import { SelfImprovementReviewPanel } from "./self-improvement-review-panel";

function elapsed(start: string, end?: string) {
  const milliseconds = new Date(end ?? Date.now()).getTime() - new Date(start).getTime();
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  return minutes ? `${minutes} min ${seconds.toString().padStart(2, "0")} s` : `${seconds} s`;
}

export function ActivityPanel({ run, onFeedback, onAnswer, onSelfImprovementApprove, onSelfImprovementReject }: { run: RunState; onFeedback: (body: string) => void; onAnswer: (answers: Record<string, string>) => void; onSelfImprovementApprove: (worktreeName: string) => void; onSelfImprovementReject: (worktreeName: string) => void }) {
  const runningAgents = activeAgents(run.agents);
  const [feedback, setFeedback] = useState("");
  const [queued, setQueued] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const demo = isDemoRun(run.id);
  const submitFeedback = () => {
    if (!feedback.trim()) return;
    // La demonstration montre le panneau sans alimenter la boucle : un retour
    // simule ecrirait un vrai fichier dans data/feedback/pending/.
    if (!demo) onFeedback(feedback);
    setFeedback("");
    setQueued(true);
  };
  return (
    <aside className="flex min-h-0 flex-col bg-[#f7f8f4]">
      {run.pendingSelfImprovementReview && <SelfImprovementReviewPanel review={run.pendingSelfImprovementReview} onApprove={() => onSelfImprovementApprove(run.pendingSelfImprovementReview!.worktreeName)} onReject={() => onSelfImprovementReject(run.pendingSelfImprovementReview!.worktreeName)} />}
      {run.pendingQuestion && <QuestionPanel key={run.pendingQuestion.id} pending={run.pendingQuestion} onAnswer={onAnswer} />}
      {run.error && <div className="m-4 flex gap-2.5 rounded-2.5 border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800"><WarningIcon className="mt-0.5 shrink-0" size={15} /> {run.error}</div>}
      <section aria-labelledby="active-agents-title" className="border-b border-[var(--line)] p-5">
        <div className="mb-4 flex items-center justify-between"><h2 id="active-agents-title" className="text-xs font-semibold">Agents</h2><span className="font-mono text-[10px] text-[var(--muted)]">{runningAgents.length} actif{runningAgents.length > 1 ? "s" : ""}</span></div>
        {runningAgents.length === 0 ? <div className="flex items-center gap-3 py-2 text-xs text-[var(--muted)]"><div className="grid size-8 place-items-center rounded-full border border-dashed border-[var(--line)]"><RobotIcon size={14} /></div>Aucun agent actif</div> :
          <div className="space-y-2.5">{runningAgents.slice(0, 5).map((agent, index) => <div key={agent.id} className="reveal flex items-center gap-3" style={{ animationDelay: `${index * 55}ms` }}>
            <div className={`grid size-8 place-items-center rounded-full bg-white shadow-[inset_0_0_0_1px_var(--line)] ${agent.status === "failed" ? "text-amber-600" : "text-[var(--accent)]"}`}>{agent.status === "running" ? <CircleNotchIcon className="animate-spin" size={14} /> : agent.status === "failed" ? <WarningIcon size={14} weight="fill" /> : <CheckIcon size={13} weight="bold" />}</div>
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
        <button type="button" disabled={run.artifacts.length === 0} onClick={() => setDocumentsOpen(true)} title="Contexte, plans, rapports de tests et de review, description de MR" className="flex w-full items-center justify-between rounded-md text-xs transition hover:text-[var(--accent)] disabled:cursor-default disabled:text-[var(--muted)]"><span className="flex items-center gap-2 font-medium"><FileTextIcon size={14} /> Documents générés</span><span className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--accent)]">{run.artifacts.length}<ArrowRightIcon size={11} /></span></button>
        {(run.status === "completed" || run.status === "failed") && <div className="mt-4 border-t border-[var(--line)] pt-4">
          <div className="flex items-center justify-between gap-2">
            <label className="text-[11px] font-semibold" htmlFor="run-feedback">Faire progresser le harnais</label>
            {demo && <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 font-mono text-[9px] text-[var(--accent)]">démo</span>}
          </div>
          <textarea id="run-feedback" value={feedback} onChange={(event) => { setFeedback(event.target.value); setQueued(false); }} rows={2} placeholder="Ce qui a ralenti, manqué ou mal fonctionné…" className="field mt-2 resize-none text-[11px] leading-4" />
          <button type="button" disabled={!feedback.trim()} onClick={submitFeedback} className="mt-2 w-full rounded-lg bg-[var(--accent)] px-3 py-2 text-[11px] font-semibold text-white transition hover:opacity-90 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35">Ajouter à la boucle d’auto-amélioration</button>
          {queued && <p className="mt-2 text-[10px] leading-4 text-[var(--accent)]">{demo ? "Retour simulé. Rien n’a été enregistré." : <>Retour enregistré. Lance <code>impl improve</code> pour produire l&apos;amélioration.</>}</p>}
        </div>}
      </section>
      {documentsOpen && <DocumentViewer documents={run.artifacts} workflowActive={run.status === "starting" || run.status === "running" || run.status === "attention"} pendingQuestionCount={run.pendingQuestion?.questions.length ?? 0} onClose={() => setDocumentsOpen(false)} />}
    </aside>
  );
}
