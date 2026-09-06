import { expect, type Page } from "@playwright/test";

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

export async function runDemoToCompletion(page: Page) {
  await page.goto("/?demo=1");
  await expect(page.getByText("Décision requise")).toBeVisible();
  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Garder les alertes critiques" }).click();
  await page.getByRole("button", { name: "Transmettre à Claude" }).click();
  await expect(page.getByText("Démonstration terminée", { exact: true })).toBeVisible();
}
