export type MessageBlock = { kind: "text" | "code"; content: string };
export type InlineSegment = { kind: "plain" | "strong" | "code"; value: string };

const INLINE = /\*\*([^*]+)\*\*|`([^`\n]+)`/g;

/** Fenced blocks and tables stay monospace; the rest is prose with its line breaks kept. */
export function messageBlocks(text: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  let kind: MessageBlock["kind"] = "text";
  let fenced = false;
  let lines: string[] = [];

  const flush = () => {
    const content = lines.join("\n").replace(/^\n+|\n+$/g, "");
    if (content.trim()) blocks.push({ kind, content: kind === "text" ? content.replace(/^#{1,6}\s+(.+)$/gm, "**$1**") : content });
    lines = [];
  };

  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      flush();
      fenced = !fenced;
      kind = fenced ? "code" : "text";
      continue;
    }
    if (!fenced) {
      const wanted = line.trimStart().startsWith("|") ? "code" : "text";
      if (wanted !== kind) { flush(); kind = wanted; }
    }
    lines.push(line);
  }
  flush();
  return blocks;
}

export function inlineSegments(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > index) segments.push({ kind: "plain", value: text.slice(index, match.index) });
    segments.push(match[1] === undefined ? { kind: "code", value: match[2] } : { kind: "strong", value: match[1] });
    index = match.index + match[0].length;
  }
  if (index < text.length) segments.push({ kind: "plain", value: text.slice(index) });
  return segments;
}
