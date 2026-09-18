"use client";

import { CheckIcon, CircleNotchIcon, CodeIcon, TrashIcon, WarningIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { PendingSelfImprovementReview } from "@/lib/types";

function DiffModal({ worktreeName, onClose }: { worktreeName: string; onClose: () => void }) {
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/self-improvement/diff?worktree=${encodeURIComponent(worktreeName)}`)
      .then((r) => r.json() as Promise<{ diff?: string; error?: string }>)
      .then((data) => { if (data.error) setError(data.error); else setDiff(data.diff ?? ""); })
      .catch(() => setError("Impossible de récupérer le diff."));
  }, [worktreeName]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Diff des améliorations proposées" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-4.5 border border-[var(--line)] bg-[var(--surface)] shadow-[0_30px_80px_-30px_rgba(20,30,25,.55)]">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3.5">
          <div className="flex items-center gap-2 text-sm font-semibold"><CodeIcon size={15} /> Améliorations · {worktreeName}</div>
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

/**
 * One strip per pending improvement, above the runs. Each used to be a stacked
 * card with buttons spanning the whole console: a review prompt that took a
 * quarter of the window and pushed the run it belonged next to off the bottom.
 * The card now owns the viewport height, so anything above the runs has to earn
 * its pixels, and this earns one line.
 */
function Strip({ tone, children }: { tone: "accent" | "muted"; children: React.ReactNode }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-5 py-2.5 md:px-7 ${tone === "accent" ? "border-[var(--line)] bg-[var(--accent-soft)]" : "border-[var(--line)] bg-[var(--paper)]"}`}>
      {children}
    </div>
  );
}

function Name({ children }: { children: React.ReactNode }) {
  return <span className="truncate font-mono text-[9px] text-[var(--muted)]">{children}</span>;
}

const ACTION = "flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-white px-2.5 py-1.5 text-[11px] font-medium transition hover:bg-[var(--paper)] active:translate-y-px";

function AnalyzingRow({ review }: { review: PendingSelfImprovementReview }) {
  return (
    <Strip tone="muted">
      <p className="flex min-w-0 items-center gap-2 text-[11px]">
        <CircleNotchIcon size={12} className="shrink-0 animate-spin text-[var(--muted)]" />
        <span className="font-semibold text-[var(--muted)]">Auto-amélioration en cours d’analyse</span>
        <Name>{review.worktreeName}</Name>
      </p>
    </Strip>
  );
}

function OrphanedRow({ review, onClean }: { review: PendingSelfImprovementReview; onClean: () => void }) {
  return (
    <Strip tone="muted">
      <p className="flex min-w-0 items-center gap-2 text-[11px]">
        <span className="font-semibold text-[var(--muted)]">Auto-amélioration déjà intégrée</span>
        <Name>{review.worktreeName} · aucun commit à fusionner</Name>
      </p>
      <button type="button" onClick={onClean} className={`${ACTION} text-[var(--muted)] hover:text-red-700`}><TrashIcon size={12} /> Nettoyer</button>
    </Strip>
  );
}

function ReviewRow({ review, onApprove, onReject, onViewDiff }: { review: PendingSelfImprovementReview; onApprove: () => void; onReject: () => void; onViewDiff: () => void }) {
  return (
    <Strip tone="accent">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex min-w-0 items-center gap-2 text-[11px]">
          <span className="font-semibold text-[var(--accent)]">Améliorations prêtes</span>
          <Name>{review.worktreeName} · {review.commits} commit{review.commits > 1 ? "s" : ""}</Name>
        </p>
        {review.mergesCleanly === false && (
          <p className="flex items-start gap-1.5 text-[10px] leading-4 text-red-700">
            <WarningIcon size={12} className="mt-px shrink-0" />
            Le rebase automatique sur le harnais n’a pas suffi : cette branche est en conflit réel. À reprendre à la main.
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={onViewDiff} className={ACTION}><CodeIcon size={12} /> Voir les changements</button>
        <button type="button" onClick={onApprove} className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90 active:translate-y-px"><CheckIcon size={12} weight="bold" /> Fusionner</button>
        <button type="button" onClick={onReject} className={`${ACTION} text-[var(--muted)] hover:text-red-700`}><TrashIcon size={12} /> Ignorer</button>
      </div>
    </Strip>
  );
}

export function SelfImprovementReviewPanel({ reviews, onApprove, onReject }: { reviews: PendingSelfImprovementReview[]; onApprove: (worktreeName: string) => void; onReject: (worktreeName: string) => void }) {
  const [diffWorktree, setDiffWorktree] = useState<string | null>(null);

  if (reviews.length === 0) return null;

  return (
    <>
      {reviews.map((review) => review.status === "analyzing"
        ? <AnalyzingRow key={review.worktreeName} review={review} />
        : review.status === "orphaned"
        ? <OrphanedRow key={review.worktreeName} review={review} onClean={() => onReject(review.worktreeName)} />
        : <ReviewRow key={review.worktreeName} review={review} onApprove={() => onApprove(review.worktreeName)} onReject={() => onReject(review.worktreeName)} onViewDiff={() => setDiffWorktree(review.worktreeName)} />)}
      {diffWorktree && <DiffModal worktreeName={diffWorktree} onClose={() => setDiffWorktree(null)} />}
    </>
  );
}
