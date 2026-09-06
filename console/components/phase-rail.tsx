"use client";

import { CheckIcon } from "@phosphor-icons/react";
import type { RunState, Status } from "@/lib/types";

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

export function PhaseRail({ run }: { run: RunState }) {
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
