import process from "node:process";

let input = "";
for await (const chunk of process.stdin) input += chunk;

const endpoint = process.env.X_IMPLEMENT_HARNESS_HOOK_URL;
if (!endpoint) process.exit(0);

try {
  const payload = JSON.parse(input || "{}");
  await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runId: process.env.X_IMPLEMENT_RUN_ID,
      receivedAt: new Date().toISOString(),
      payload,
    }),
    signal: AbortSignal.timeout(800),
  });
} catch {
  // The harness is optional: hooks must never interrupt Claude Code.
}
