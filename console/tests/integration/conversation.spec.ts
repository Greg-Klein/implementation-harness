import { expect, test } from "@playwright/test";
import { resetRun, runDemoToCompletion } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

test("should show the dialogue and keep the terminal one click away", async ({ page }) => {
  await page.goto("/?demo=1");

  const conversation = page.getByRole("log", { name: "Conversation" });
  const composer = page.getByLabel("Instruction pour Claude");
  await expect(conversation.getByText("Lecture du ticket GitLab simulé…")).toBeVisible();
  await expect(composer).toBeVisible();

  await page.getByRole("tab", { name: "Terminal" }).click();
  await expect(composer).toBeHidden();

  await page.getByRole("tab", { name: "Conversation" }).click();
  await expect(composer).toBeVisible();
});

test("should send a typed instruction into the conversation", async ({ page }) => {
  await page.goto("/?demo=1");

  const conversation = page.getByRole("log", { name: "Conversation" });
  await page.getByLabel("Instruction pour Claude").fill("reste sur desktop");
  await page.getByRole("button", { name: "Envoyer l’instruction" }).click();

  await expect(conversation.getByText("reste sur desktop")).toBeVisible();
  await expect(conversation.getByText("Instruction prise en compte. La démonstration ne modifie aucun dépôt.")).toBeVisible();
  await expect(page.getByLabel("Instruction pour Claude")).toHaveValue("");
});

test("should say a message is on its way while the session is still talking", async ({ page }) => {
  await page.goto("/?demo=1");

  const conversation = page.getByRole("log", { name: "Conversation" });
  await expect(conversation.getByText("Claude réfléchit…")).toBeVisible();

  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Garder les alertes critiques" }).click();
  await page.getByRole("button", { name: "Transmettre à Claude" }).click();
  await expect(page.getByText("Démonstration terminée", { exact: true })).toBeVisible();

  // The run is over: nothing is being written any more.
  await expect(conversation.getByText("Claude réfléchit…")).toBeHidden();
});

test("should hand back the launch form after a finished run", async ({ page }) => {
  await runDemoToCompletion(page);

  await page.getByRole("button", { name: "Nouveau run" }).click();

  await expect(page.getByRole("button", { name: "Lancer l’implémentation" })).toBeVisible();
  await expect(page.getByRole("log", { name: "Conversation" })).toBeHidden();
});

test("should clear the launch form fields when starting a new run", async ({ page }) => {
  await page.goto("/");

  // Filled before the ticket URL so the project auto-detection (debounced,
  // and only kicking in while the project field is empty) never overwrites it.
  await page.getByLabel("Répertoire du projet").fill("acme-dashboard");
  await page.getByLabel("Ticket GitLab").fill("https://gitlab.com/acme/demo/-/issues/217");
  await page.getByLabel("Instruction particulière").fill("reste sur desktop");

  // Trigger the demo through the socket directly: a fresh navigation to
  // /?demo=1 would reload the page and lose the values just typed above.
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    const timeout = window.setTimeout(() => { socket.close(); reject(new Error("demo.start timeout")); }, 3_000);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "demo.start" })));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "state" && message.state.status !== "idle") {
        window.clearTimeout(timeout);
        socket.close();
        resolve();
      }
    });
  }));

  await expect(page.getByText("Décision requise")).toBeVisible();
  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Garder les alertes critiques" }).click();
  await page.getByRole("button", { name: "Transmettre à Claude" }).click();
  await expect(page.getByText("Démonstration terminée", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Nouveau run" }).click();

  await expect(page.getByLabel("Ticket GitLab")).toHaveValue("");
  await expect(page.getByLabel("Répertoire du projet")).toHaveValue("");
  await expect(page.getByLabel("Instruction particulière")).toHaveValue("");
});
