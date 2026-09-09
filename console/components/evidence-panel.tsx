"use client";

import { CheckCircleIcon, MinusCircleIcon, WarningCircleIcon, XCircleIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { ArtifactResponse, EvidenceItem, EvidenceReport, EvidenceVerdict, RunState } from "@/lib/types";

const SOURCES: { file: string; title: string }[] = [
  { file: "dev-evidence.json", title: "Navigateur" },
  { file: "qa-evidence.json", title: "Tests & vérifications" },
  { file: "design-evidence.json", title: "Conformité au design" },
];

const VERDICT_STYLE: Record<EvidenceVerdict, { label: string; className: string; icon: typeof CheckCircleIcon }> = {
  pass: { label: "Passe", className: "bg-emerald-50 text-emerald-700", icon: CheckCircleIcon },
  measured: { label: "Mesuré", className: "bg-emerald-50 text-emerald-700", icon: CheckCircleIcon },
  confirmed: { label: "Confirmé", className: "bg-emerald-50 text-emerald-700", icon: CheckCircleIcon },
  fail: { label: "Échec", className: "bg-red-50 text-red-700", icon: XCircleIcon },
  not_run: { label: "Non exécuté", className: "bg-[var(--paper)] text-[var(--muted)]", icon: MinusCircleIcon },
  unverified: { label: "Non vérifié", className: "bg-amber-50 text-amber-700", icon: WarningCircleIcon },
};

async function fetchArtifact(path: string): Promise<ArtifactResponse> {
  const response = await fetch(`/api/artifacts?path=${encodeURIComponent(path)}`);
  const result = await response.json() as ArtifactResponse;
  if (!response.ok) throw new Error(result.error ?? "Impossible de charger ce document.");
  return result;
}

function Screenshot({ path }: { path: string }) {
  const [image, setImage] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    fetchArtifact(path)
      .then((result) => { if (!cancelled && result.encoding === "base64" && result.contentType) setImage(`data:${result.contentType};base64,${result.content}`); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [path]);
  if (!image) return null;
  return <a href={image} target="_blank" rel="noreferrer" className="mt-1.5 inline-block"><img src={image} alt="" className="max-h-32 rounded-md border border-[var(--line)]" /></a>;
}

function Row({ item }: { item: EvidenceItem }) {
  const style = VERDICT_STYLE[item.verdict] ?? VERDICT_STYLE.unverified;
  const Icon = style.icon;
  return (
    <li className="border-b border-[var(--line)] py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-[var(--ink)]">{item.label}</p>
        <span className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${style.className}`}><Icon size={11} weight="fill" />{style.label}</span>
      </div>
      {(item.expected || item.actual) && (
        <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">
          {item.expected && <>attendu <span className="text-[var(--ink)]">{item.expected}</span>{item.actual ? " · " : ""}</>}
          {item.actual && <>mesuré <span className="text-[var(--ink)]">{item.actual}</span></>}
        </p>
      )}
      {item.command && <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">{item.command}</p>}
      {item.note && <p className="mt-1 text-[10px] text-[var(--muted)]">{item.note}</p>}
      {item.screenshot && <Screenshot path={item.screenshot} />}
    </li>
  );
}

function Section({ title, file, run }: { title: string; file: string; run: RunState }) {
  const [report, setReport] = useState<EvidenceReport>();
  const [error, setError] = useState<string>();
  const present = run.artifacts.includes(file);

  useEffect(() => {
    if (!present) { setReport(undefined); setError(undefined); return; }
    let cancelled = false;
    fetchArtifact(file)
      .then((result) => { if (cancelled) return; try { setReport(JSON.parse(result.content) as EvidenceReport); } catch { setError("Document illisible."); } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Erreur."); });
    return () => { cancelled = true; };
  }, [file, present, run.id]);

  return (
    <section className="mb-6 last:mb-0">
      <h3 className="mb-2 text-xs font-semibold text-[var(--ink)]">
        {title}
        {report?.status && <span className="ml-2 font-mono text-[10px] font-normal text-[var(--muted)]">{report.status}</span>}
      </h3>
      {!present ? <p className="text-[11px] text-[var(--muted)]">Non exécuté à ce tier.</p>
        : error ? <p className="text-[11px] text-red-700">{error}</p>
        : !report ? <p className="text-[11px] text-[var(--muted)]">Chargement…</p>
        : report.items.length === 0 ? <p className="text-[11px] text-[var(--muted)]">Aucun élément rapporté.</p>
        : <ul>{report.items.map((item, index) => <Row key={index} item={item} />)}</ul>}
    </section>
  );
}

export function EvidencePanel({ run }: { run: RunState }) {
  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-white p-5">
      {SOURCES.map(({ file, title }) => <Section key={file} title={title} file={file} run={run} />)}
    </div>
  );
}
