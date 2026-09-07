"use client";

import { inlineSegments } from "@/lib/conversation";

export function InlineText({ text }: { text: string }) {
  return <>{inlineSegments(text).map((segment, index) => segment.kind === "strong"
    ? <strong key={index} className="font-semibold">{segment.value}</strong>
    : segment.kind === "code"
      ? <code key={index} className="rounded bg-[var(--accent-soft)] px-1 py-0.5 font-mono text-[.95em]">{segment.value}</code>
      : segment.kind === "link"
        ? <a key={index} href={segment.href} target="_blank" rel="noreferrer" className="text-[var(--doc)] underline underline-offset-2 hover:opacity-80">{segment.value}</a>
        : <span key={index}>{segment.value}</span>)}</>;
}
