import type { Page } from "@playwright/test";

export async function resetRun(page: Page) {
  await page.goto("/");
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    const timeout = window.setTimeout(() => { socket.close(); reject(new Error("Reset timeout")); }, 3_000);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "run.reset" })));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "state" && message.state.status === "idle") {
        window.clearTimeout(timeout);
        socket.close();
        resolve();
      }
    });
  }));
}
