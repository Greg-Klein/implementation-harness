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

test("should hand back the launch form after a finished run", async ({ page }) => {
  await runDemoToCompletion(page);

  await page.getByRole("button", { name: "Nouveau run" }).click();

  await expect(page.getByRole("button", { name: "Lancer l’implémentation" })).toBeVisible();
  await expect(page.getByRole("log", { name: "Conversation" })).toBeHidden();
});
