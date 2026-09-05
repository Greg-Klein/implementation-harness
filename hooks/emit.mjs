import process from "node:process";

let input = "";
for await (const chunk of process.stdin) input += chunk;

const endpoint = process.env.X_IMPLEMENT_HARNESS_HOOK_URL;
if (!endpoint) process.exit(0);

try {
  const payload = JSON.parse(input || "{}");
  const waitsForHarnessAnswer = payload.hook_event_name === "PreToolUse" && payload.tool_name === "AskUserQuestion";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runId: process.env.X_IMPLEMENT_RUN_ID,
      receivedAt: new Date().toISOString(),
      payload,
    }),
    signal: AbortSignal.timeout(waitsForHarnessAnswer ? 3_600_000 : 800),
  });
  if (waitsForHarnessAnswer && response.ok) {
    const result = await response.json();
    if (result.hookOutput) process.stdout.write(JSON.stringify(result.hookOutput));
  }
} catch {
  // The harness is optional: hooks must never interrupt Claude Code.
}
