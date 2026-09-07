"use client";

import { CheckIcon, WarningIcon } from "@phosphor-icons/react";
import { elapsedLabel } from "@/lib/run-state";
import { useNow } from "@/lib/use-now";
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

export function PhaseRail({ run }: { run: RunState }) {
  const now = useNow(Boolean(run.startedAt) && !run.endedAt);
  const finished = run.status === "completed";

  return (
    <aside className="p-5">
      <div className="mb-6 flex items-center justify-between"><span className="text-xs font-semibold">Progression</span><span className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${run.status === "attention" ? "bg-amber-100 text-amber-800" : "bg-[var(--accent-soft)] text-[var(--accent)]"}`}>{run.status === "attention" && <WarningIcon size={10} weight="fill" />}{statusLabel(run.status)}</span></div>
      <ol>{phases.map((phase, index) => {
        // The last step is only ticked when the run itself is over, never just
        // because the workflow reached it.
        const number = index + 1; const done = number < run.phase || finished; const current = number === run.phase && !finished;
        return <li key={phase} className="relative flex min-h-10 gap-3 text-xs">
          {index < phases.length - 1 && <span className={`absolute left-[9px] top-5 h-5 w-px ${done ? "bg-[var(--accent)]" : "bg-[var(--line)]"}`} />}
          <span className={`relative grid size-5 shrink-0 place-items-center rounded-full border font-mono text-[9px] ${done ? "border-[var(--accent)] bg-[var(--accent)] text-white" : current ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--line)] bg-[var(--surface)] text-[var(--muted)]"}`}>{done ? <CheckIcon size={10} weight="bold" /> : number}</span>
          <span className={`pt-0.5 ${current ? "font-semibold text-[var(--ink)]" : done ? "text-[var(--ink)]" : "text-[var(--muted)]"}`}>{phase}</span>
        </li>;
      })}</ol>
      <div className="mt-6 border-t border-[var(--line)] pt-4"><p className="truncate font-mono text-[10px] text-[var(--muted)]" title={run.cwd}>{run.cwd}</p>{run.startedAt && <p className="mt-2 font-mono text-[10px] text-[var(--muted)]">{elapsedLabel(run.startedAt, run.endedAt ?? undefined, now)}</p>}</div>
    </aside>
  );
}
