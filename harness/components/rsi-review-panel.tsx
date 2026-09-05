"use client";

import { CheckIcon, CodeIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { PendingRsiReview } from "@/lib/types";

function DiffModal({ worktreeName, onClose }: { worktreeName: string; onClose: () => void }) {
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/rsi/diff?worktree=${encodeURIComponent(worktreeName)}`)
      .then((r) => r.json() as Promise<{ diff?: string; error?: string }>)
      .then((data) => { if (data.error) setError(data.error); else setDiff(data.diff ?? ""); })
      .catch(() => setError("Impossible de récupérer le diff."));
  }, [worktreeName]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Diff des améliorations RSI" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--surface)] shadow-[0_30px_80px_-30px_rgba(20,30,25,.55)]">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3.5">
          <div className="flex items-center gap-2 text-sm font-semibold"><CodeIcon size={15} /> Améliorations RSI · {worktreeName}</div>
          <button type="button" onClick={onClose} className="grid size-7 place-items-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--paper)] hover:text-[var(--ink)]"><XIcon size={15} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!diff && !error && <p className="p-5 text-xs text-[var(--muted)]">Chargement du diff…</p>}
          {error && <p className="p-5 text-xs text-red-700">{error}</p>}
          {diff && (
            <pre className="whitespace-pre-wrap break-all p-5 font-mono text-[11px] leading-5">
              {diff.split("\n").map((line, i) => (
                <span key={i} className={line.startsWith("+") && !line.startsWith("+++") ? "text-emerald-700" : line.startsWith("-") && !line.startsWith("---") ? "text-red-700" : line.startsWith("@@") ? "text-blue-600" : "text-[var(--ink)]"}>
                  {line}{"\n"}
                </span>
              ))}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

export function RsiReviewPanel({ review, onApprove, onReject }: { review: PendingRsiReview; onApprove: () => void; onReject: () => void }) {
  const [diffOpen, setDiffOpen] = useState(false);

  return (
    <>
      <div className="m-4 rounded-[12px] border border-[var(--accent)] bg-[var(--accent-soft)] p-4">
        <p className="mb-1 text-[11px] font-semibold text-[var(--accent)]">Améliorations RSI prêtes</p>
        <p className="mb-3 font-mono text-[9px] text-[var(--muted)]">{review.worktreeName}</p>
        <button type="button" onClick={() => setDiffOpen(true)} className="mb-3 flex w-full items-center gap-2 rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-[11px] font-medium transition hover:bg-[var(--paper)]">
          <CodeIcon size={13} /> Voir les changements
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={onApprove} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-[11px] font-semibold text-white transition hover:opacity-90 active:translate-y-px">
            <CheckIcon size={12} weight="bold" /> Fusionner
          </button>
          <button type="button" onClick={onReject} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-[11px] font-medium text-[var(--muted)] transition hover:text-red-700 active:translate-y-px">
            <TrashIcon size={12} /> Ignorer
          </button>
        </div>
      </div>
      {diffOpen && <DiffModal worktreeName={review.worktreeName} onClose={() => setDiffOpen(false)} />}
    </>
  );
}
