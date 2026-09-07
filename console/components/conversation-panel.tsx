"use client";

import { ChatCircleDotsIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { inlineSegments, messageBlocks } from "@/lib/conversation";
import type { ConversationMessage } from "@/lib/types";

function MessageBody({ text }: { text: string }) {
  return <>{messageBlocks(text).map((block, index) => block.kind === "code"
    ? <pre key={index} className="scrollbar-thin mt-2 overflow-x-auto rounded-2.5 border border-[var(--line)] bg-[#f1f3ee] p-3 font-mono text-[10px] leading-4 first:mt-0">{block.content}</pre>
    : <p key={index} className="mt-2 whitespace-pre-wrap text-[12.5px] leading-5 first:mt-0">{inlineSegments(block.content).map((segment, position) => segment.kind === "strong"
      ? <strong key={position} className="font-semibold">{segment.value}</strong>
      : segment.kind === "code"
        ? <code key={position} className="rounded bg-[var(--accent-soft)] px-1 py-0.5 font-mono text-[11px]">{segment.value}</code>
        : <span key={position}>{segment.value}</span>)}</p>)}</>;
}

export function ConversationPanel({ messages, canSend, onSend }: { messages: ConversationMessage[]; canSend: boolean; onSend: (text: string) => void }) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    const list = listRef.current;
    if (list && pinnedRef.current) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = "auto";
    composer.style.height = `${composer.scrollHeight}px`;
  }, [draft]);

  const send = () => {
    if (!draft.trim() || !canSend) return;
    pinnedRef.current = true;
    onSend(draft.trim());
    setDraft("");
  };

  return (
    <>
      <div
        ref={listRef}
        role="log"
        aria-label="Conversation"
        onScroll={() => { const list = listRef.current; if (list) pinnedRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80; }}
        className="scrollbar-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-6 md:px-7"
      >
        {messages.length === 0 ? <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <div className="grid size-10 place-items-center rounded-full border border-dashed border-[var(--line)] text-[var(--muted)]"><ChatCircleDotsIcon size={18} /></div>
          <p className="max-w-70 text-xs leading-5 text-[var(--muted)]">Les échanges avec Claude apparaissent ici. Les appels d’outils et les agents restent dans l’onglet Terminal.</p>
        </div> : messages.map((message, index) => (
          <article key={message.id} className={`reveal flex flex-col ${message.author === "user" ? "items-end" : "items-start"}`} style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}>
            <div className="mb-1.5 flex items-center gap-1.5 px-1 font-mono text-[9px] uppercase tracking-[.08em] text-[var(--muted)]">
              {message.author === "claude" && <span className="size-1.5 rounded-full bg-[var(--accent)]" />}
              <span>{message.author === "claude" ? "Claude" : "Toi"}</span>
              <span aria-hidden="true">·</span>
              <span>{new Date(message.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            <div className={`max-w-[min(680px,92%)] rounded-3 px-4 py-3 ${message.author === "user" ? "bg-[var(--accent-soft)] text-[var(--ink)]" : "border border-[var(--line)] bg-white shadow-[0_10px_30px_-26px_rgba(30,42,35,.5)]"}`}>
              <MessageBody text={message.text} />
            </div>
          </article>
        ))}
      </div>
      <form
        onSubmit={(event) => { event.preventDefault(); send(); }}
        className="shrink-0 border-t border-[var(--line)] bg-[#f1f3ee] p-4 md:px-7"
      >
        <div className="flex items-end gap-2.5">
          <label className="sr-only" htmlFor="instruction">Instruction pour Claude</label>
          <textarea
            id="instruction"
            ref={composerRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }}
            rows={1}
            disabled={!canSend}
            placeholder={canSend ? "Transmettre une instruction à Claude…" : "Aucune session active."}
            className="field max-h-32 resize-none text-[12.5px] leading-5 disabled:opacity-50"
          />
          <button type="submit" disabled={!draft.trim() || !canSend} aria-label="Envoyer l’instruction" className="grid size-11 shrink-0 place-items-center rounded-[11px] bg-[var(--ink)] text-white transition hover:bg-[#2a322e] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35">
            <PaperPlaneTiltIcon size={16} weight="fill" />
          </button>
        </div>
        <p className="mt-2 text-[10px] text-[var(--muted)]">Entrée pour envoyer, Maj+Entrée pour un saut de ligne.</p>
      </form>
    </>
  );
}
