import { expect, test } from "@playwright/test";

test("le lecteur reste ouvert jusqu’à une clarification et le workflow reprend après la réponse", async ({ page, request }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/?demo=1");
  await expect(page.getByText("Contexte du ticket consolidé")).toBeVisible({ timeout: 8_000 });

  await page.getByRole("button", { name: /Documents générés/ }).click();
  const reader = page.getByRole("dialog", { name: "Documents générés" });
  await expect(reader.getByText("IH-42 · Préférences de notification")).toBeVisible();
  await expect(reader.getByText("Le workflow continue en arrière-plan")).toBeVisible();

  await expect(reader.getByText("Claude attend 2 réponses")).toBeVisible({ timeout: 8_000 });
  const stateResponse = await request.get("/api/state");
  const { state } = await stateResponse.json();
  expect(state.phase).toBe(2);
  expect(state.status).toBe("attention");
  await expect(reader).toBeVisible();

  await reader.getByRole("button", { name: "Répondre" }).click();
  await expect(reader).toBeHidden();
  await expect(page.getByText("Décision requise")).toBeVisible();
  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Garder les alertes critiques" }).click();
  await page.getByRole("button", { name: "Transmettre à Claude" }).click();

  await expect(page.getByText("Plan d’implémentation validé")).toBeVisible({ timeout: 8_000 });
  await page.getByRole("button", { name: /Documents générés/ }).click();
  await reader.getByRole("button", { name: "implementation-plan.md" }).click();
  await expect(reader.getByText("Ajouter le modèle de préférences.")).toBeVisible();
  await reader.getByRole("button", { name: "Fermer" }).click();

  const agents = page.getByRole("region", { name: "Agents" });
  await expect(page.getByText("developer démarre")).toBeVisible({ timeout: 8_000 });
  await expect(agents.getByText("developer", { exact: true })).toBeVisible();
  await expect(page.getByText("Implémentation terminée, vérifications en cours")).toBeVisible({ timeout: 8_000 });
  await expect(agents.getByText("senior-reviewer", { exact: true })).toBeVisible();
  await expect(agents.getByText("developer", { exact: true })).toHaveCount(0);

  const traversalResponse = await request.get("/api/artifacts?path=../run.json");
  expect(traversalResponse.status()).toBe(404);
  expect(browserErrors).toEqual([]);
});
