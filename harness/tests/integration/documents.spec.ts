import { expect, test } from "@playwright/test";
import { resetRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

test("should keep the document reader open until clarification requires an answer", async ({ page, request }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/?demo=1");
  await expect(page.getByText("Contexte du ticket consolidé")).toBeVisible();
  await page.getByRole("button", { name: /Documents générés/ }).click();

  const reader = page.getByRole("dialog", { name: "Documents générés" });
  await expect(reader.getByText("IH-42 · Préférences de notification")).toBeVisible();
  await expect(reader.getByText("Le workflow continue en arrière-plan")).toBeVisible();
  await expect(reader.getByText("Claude attend 2 réponses")).toBeVisible();

  const { state } = await (await request.get("/api/state")).json();
  expect(state).toMatchObject({ phase: 2, status: "attention" });
  await expect(reader).toBeVisible();

  await reader.getByRole("button", { name: "Répondre" }).click();
  await expect(reader).toBeHidden();
  await expect(page.getByText("Décision requise")).toBeVisible();
  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Garder les alertes critiques" }).click();
  await page.getByRole("button", { name: "Transmettre à Claude" }).click();

  await expect(page.getByText("Plan d’implémentation validé")).toBeVisible();
  await page.getByRole("button", { name: /Documents générés/ }).click();
  await reader.getByRole("button", { name: "implementation-plan.md" }).click();
  await expect(reader.getByText("Ajouter le modèle de préférences.")).toBeVisible();
  await reader.getByRole("button", { name: "Fermer" }).click();

  const agents = page.getByRole("region", { name: "Agents" });
  await expect(page.getByText("developer démarre")).toBeVisible();
  await expect(agents.getByText("developer", { exact: true })).toBeVisible();
  await expect(page.getByText("Implémentation terminée, vérifications en cours")).toBeVisible();
  await expect(agents.getByText("senior-reviewer", { exact: true })).toBeVisible();
  await expect(agents.getByText("developer", { exact: true })).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test("should expose only generated documents from the current run", async ({ page, request }) => {
  await page.goto("/?demo=1");
  await expect(page.getByText("Contexte du ticket consolidé")).toBeVisible();

  const response = await request.get("/api/artifacts?path=ticket-context.md");
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({
    path: "ticket-context.md",
    kind: "text",
    content: expect.stringContaining("Critères d’acceptation"),
  });
  expect((await request.get("/api/artifacts?path=not-generated.md")).status()).toBe(404);
  expect((await request.get("/api/artifacts?path=../run.json")).status()).toBe(404);
});
