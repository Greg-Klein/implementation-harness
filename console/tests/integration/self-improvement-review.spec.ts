import { expect, test } from "@playwright/test";
import { resetRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

test("should reject invalid worktree names in the diff endpoint", async ({ request }) => {
  for (const name of ["../secret", "foo/bar", "foo bar", "; rm -rf", ""]) {
    const response = await request.get(`/api/self-improvement/diff?worktree=${encodeURIComponent(name)}`);
    expect(response.status(), `expected 400 for name "${name}"`).toBe(400);
  }
});

test("should return 404 for a valid but nonexistent worktree", async ({ request }) => {
  const response = await request.get("/api/self-improvement/diff?worktree=self-improvement-nonexistent");
  expect(response.status()).toBe(404);
});

test("should surface an error when approving without a pending review", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(() =>
    new Promise<{ status: string; error?: string }>((resolve, reject) => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      const timeout = window.setTimeout(() => { socket.close(); reject(new Error("timeout")); }, 4_000);
      socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "selfImprovement.approve", worktreeName: "self-improvement-fake" })));
      socket.addEventListener("message", (event) => {
        const msg = JSON.parse(event.data) as { type: string; state?: { status: string; error?: string } };
        if (msg.type === "state" && msg.state?.status === "failed") {
          window.clearTimeout(timeout);
          socket.close();
          resolve({ status: msg.state.status, error: msg.state.error });
        }
      });
    }),
  );
  expect(result.status).toBe("failed");
  expect(result.error).toContain("auto-amélioration");
});
