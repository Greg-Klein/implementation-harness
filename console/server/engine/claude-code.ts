import { spawn as spawnChild } from "node:child_process";
import path from "node:path";
import process from "node:process";
import * as pty from "node-pty";
import { normalizeQuestion, normalizeText, withoutBundlerVariables } from "../domain.js";
import { pluginRoot } from "../config.js";
import { findExecutable } from "../repository.js";
import type { ConversationMessage, HookOutput } from "../types.js";
import type { Engine, EngineEvent, EngineSession, StartOptions } from "./types.js";

/** Long enough for the paste to be read before the submission keystroke arrives. */
const SUBMIT_DELAY_MS = 150;

/**
 * A harness started from inside a Claude Code session inherits markers that make
 * the spawned session behave like a nested one, transcript saving included, and
 * the conversation is read from that transcript. The bundler variables of the
 * console itself go with them: the agent runs builds of its own.
 */
function sessionEnvironment() {
  const environment = withoutBundlerVariables(process.env);
  for (const key of Object.keys(environment)) if (key === "CLAUDECODE" || key === "CLAUDE_PID" || key.startsWith("CLAUDE_CODE_")) delete environment[key];
  return environment;
}

/** Slash commands, task notifications and hook output reach the session as tagged blocks. */
const TAGGED_INPUT = /^<[a-z][a-z-]*>/;

/**
 * The idle notification, matched on rather than matched away: should Claude Code
 * ever reword it, the harness falls back to calling the user too often, never to
 * leaving a blocked run silent.
 */
const IDLE_NOTIFICATION = /waiting for your input/i;

function textOf(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: string; text: string } => Boolean(block) && typeof block === "object" && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string")
    .map((block) => block.text)
    .join("\n\n");
}

function conversationLine(line: string): ConversationMessage | undefined {
  let entry: Record<string, unknown>;
  try {
    entry = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (!entry || typeof entry !== "object") return undefined;
  // Sidechains are the subagents talking to themselves, meta entries are the
  // expanded prompt of a slash command: neither is the dialogue.
  if (entry.isSidechain === true || entry.isMeta === true) return undefined;
  const id = typeof entry.uuid === "string" ? entry.uuid : undefined;
  if (!id) return undefined;
  const at = typeof entry.timestamp === "string" ? entry.timestamp : new Date().toISOString();
  // An instruction typed while Claude Code is mid-turn is recorded as a queued
  // command instead of a user message.
  if (entry.type === "attachment") {
    const attachment = entry.attachment as { type?: unknown; prompt?: unknown } | undefined;
    if (attachment?.type !== "queued_command" || typeof attachment.prompt !== "string") return undefined;
    const queued = attachment.prompt.trim();
    return queued ? { id, at, author: "user", text: queued } : undefined;
  }
  const author = entry.type === "assistant" ? "claude" as const : entry.type === "user" ? "user" as const : undefined;
  if (!author) return undefined;
  const message = entry.message as { content?: unknown } | undefined;
  const text = textOf(message?.content).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
  if (!text || (author === "user" && TAGGED_INPUT.test(text))) return undefined;
  return { id, at, author, text };
}

function questionEvent(payload: Record<string, unknown>): EngineEvent | undefined {
  const input = payload.tool_input as Record<string, unknown> | undefined;
  // The hook fires again on the call the harness itself completed, and that
  // second pass carries the answers: it must not raise the question anew.
  if (!input || (input.answers && typeof input.answers === "object")) return undefined;
  const questions = Array.isArray(input.questions)
    ? input.questions.flatMap((question) => {
      const normalized = normalizeQuestion(question);
      return normalized ? [normalized] : [];
    })
    : [];
  if (questions.length === 0) return undefined;
  return { kind: "question", id: normalizeText(payload.tool_use_id), questions, input };
}

function event(payload: Record<string, unknown>): EngineEvent | undefined {
  const name = normalizeText(payload.hook_event_name) ?? "Hook";
  if (name === "SubagentStart" || name === "SubagentStop") {
    // A payload that names no agent describes nothing the interface could show,
    // and an agent entered under an empty name would never be closed by its own
    // stop event.
    const agentName = normalizeText(payload.agent_type);
    if (!agentName) return undefined;
    const agentId = normalizeText(payload.agent_id) ?? `${agentName}-${Date.now()}`;
    return { kind: name === "SubagentStart" ? "agent.start" : "agent.stop", agentId, agentName };
  }
  if (name === "Notification") {
    const message = normalizeText(payload.message);
    // Claude Code notifies a minute after the session last printed, background
    // agent still working or not, so this one repeats what the Stop event
    // already said, later and less accurately. Every other notification, a
    // permission request first of all, really does block on the user.
    if (message && IDLE_NOTIFICATION.test(message)) return undefined;
    return { kind: "attention", message };
  }
  if (name === "Stop") return { kind: "turn.end" };
  const input = payload.tool_input as Record<string, unknown> | undefined;
  // The command is passed whole: what is shown gets shortened, what is matched
  // against must not be.
  const command = typeof input?.command === "string" ? input.command : undefined;
  if (name === "PreToolUse") {
    if (normalizeText(payload.tool_name) === "AskUserQuestion") return questionEvent(payload);
    return { kind: "tool.start", command };
  }
  if (name === "PostToolUse") return { kind: "tool.end", command, response: payload.tool_response };
  return undefined;
}

function start({ cwd, runId, command, hookUrl, onData, onExit }: StartOptions): EngineSession {
  const executable = findExecutable("claude");
  if (!executable) throw new Error("Claude Code est introuvable dans PATH.");
  const terminal = pty.spawn(executable, ["--plugin-dir", pluginRoot, "--name", `implementation-harness ${path.basename(cwd)}`, command], {
    name: "xterm-256color", cols: 120, rows: 34, cwd,
    env: { ...sessionEnvironment(), TERM: "xterm-256color", COLORTERM: "truecolor", IMPL_RUN_ID: runId, IMPL_HARNESS_HOOK_URL: hookUrl },
  });
  let alive = true;
  terminal.onData(onData);
  terminal.onExit(({ exitCode }) => { alive = false; onExit(exitCode); });
  return {
    write: (data) => terminal.write(data),
    submit: (text) => {
      // Claude Code reads a burst of characters as a paste, and a carriage return
      // inside that burst is pasted content: it lands as a newline in the prompt
      // and the instruction is never submitted. The text goes as an explicit
      // paste, the submission as a keystroke of its own.
      terminal.write(`\u001b[200~${text}\u001b[201~`);
      setTimeout(() => { if (alive) terminal.write("\r"); }, SUBMIT_DELAY_MS);
    },
    resize: (cols, rows) => terminal.resize(cols, rows),
    kill: () => { alive = false; terminal.kill(); },
  };
}

export const claudeCode: Engine = {
  id: "claude-code",
  label: "Claude Code",
  locate: () => findExecutable("claude"),
  command: (issueUrl, instruction) => `/implementation-harness:implement ${issueUrl}${instruction ? ` ${instruction}` : ""}`,
  start,
  taskDirectory: (cwd) => path.join(cwd, ".claude", "tasks"),
  transcriptPath: (payload) => {
    const inner = payload.payload as Record<string, unknown> | undefined;
    const transcript = inner?.transcript_path;
    return typeof transcript === "string" && transcript ? transcript : undefined;
  },
  conversationLine,
  event,
  questionAnswer: (input, answers): HookOutput => ({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: { ...input, answers } },
  }),
  startSelfImprovement: ({ worktreeName, feedbackDirectory, runId }) => {
    const executable = findExecutable("claude");
    if (!executable) return undefined;
    return spawnChild(executable, [
      "--background", "--worktree", worktreeName,
      "--add-dir", pluginRoot,
      "--plugin-dir", pluginRoot,
      "--permission-mode", "auto",
      "--name", `implementation-harness self-improvement ${runId.slice(-8)}`,
      `/implementation-harness:improve ${feedbackDirectory}`,
    ], { cwd: pluginRoot, env: sessionEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
  },
};
