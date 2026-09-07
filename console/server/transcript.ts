import { open } from "node:fs/promises";
import chokidar, { type FSWatcher } from "chokidar";
import { ctx, conversationMessage, publishState } from "./context.js";
import { parseConversationLine } from "./domain.js";

let watcher: FSWatcher | null = null;
let watchedPath: string | undefined;
let offset = 0;
let carry = "";

async function readNewMessages(file: string) {
  const handle = await open(file, "r").catch(() => null);
  if (!handle) return;
  try {
    const { size } = await handle.stat();
    if (size < offset) { offset = 0; carry = ""; }
    if (size === offset) return;
    const buffer = Buffer.alloc(size - offset);
    await handle.read(buffer, 0, buffer.byteLength, offset);
    offset = size;
    const lines = (carry + buffer.toString("utf8")).split("\n");
    carry = lines.pop() ?? "";
    let published = false;
    for (const line of lines) {
      const message = parseConversationLine(line);
      if (!message || ctx.state.messages.some((entry) => entry.id === message.id)) continue;
      conversationMessage(message);
      published = true;
    }
    if (published) publishState();
  } finally {
    await handle.close();
  }
}

/** Claude Code appends every message of the session to this file, so it is the only faithful source for the dialogue. */
export async function followTranscript(transcriptPath: string) {
  if (watchedPath === transcriptPath) return;
  await closeTranscript();
  watchedPath = transcriptPath;
  watcher = chokidar.watch(transcriptPath, { ignoreInitial: false });
  watcher.on("add", () => void readNewMessages(transcriptPath));
  watcher.on("change", () => void readNewMessages(transcriptPath));
}

export async function closeTranscript() {
  await watcher?.close();
  watcher = null;
  watchedPath = undefined;
  offset = 0;
  carry = "";
}
