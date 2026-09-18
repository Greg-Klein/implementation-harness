import { expect, test } from "@playwright/test";
import { currentRunState, expectDemoCompleted, resetRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

test("should loop through requested changes before completing the review", async ({ page, request }) => {
  await page.goto("/?demo=1");
  await expect(page.getByText("Décision requise")).toBeVisible();
  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Garder les alertes critiques" }).click();
  await page.getByRole("button", { name: "Transmettre à Claude" }).click();

  await expect(page.getByRole("log", { name: "Conversation" }).getByText("Review 1/2 : changements demandés sur le fallback et sa couverture de test.")).toBeVisible();
  await expect(page.getByRole("log", { name: "Conversation" }).getByText("Boucle vers l’implémentation : correction du fallback et ajout du test manquant…")).toBeVisible();
  await expect(page.getByRole("log", { name: "Conversation" }).getByText("Review 2/2 : approuvée. Les retours ont bien été pris en compte.")).toBeVisible();
  await expectDemoCompleted(page);

  await expect.poll(() => currentRunState(request)).toMatchObject({
    status: "completed",
    phase: 10,
    artifacts: expect.arrayContaining(["senior-review-round-1.md", "senior-review-round-2.md", "mr-description.md"]),
    agents: expect.arrayContaining([
      expect.objectContaining({ name: "developer", status: "completed" }),
      expect.objectContaining({ name: "senior-reviewer", status: "completed" }),
    ]),
  });
});
