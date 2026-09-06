import { expect, test } from "@playwright/test";
import { resetRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

test("should loop through requested changes before completing the review", async ({ page, request }) => {
  await page.goto("/?demo=1");
  await expect(page.getByText("Décision requise")).toBeVisible();
  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Garder les alertes critiques" }).click();
  await page.getByRole("button", { name: "Transmettre à Claude" }).click();

  await expect(page.getByText("Review : corrections demandées", { exact: true })).toBeVisible();
  await expect(page.getByText("developer reprend l’implémentation", { exact: true })).toBeVisible();
  await expect(page.getByText("Review 2/2 approuvée", { exact: true })).toBeVisible();
  await expect(page.getByText("Démonstration terminée", { exact: true })).toBeVisible();

  await expect.poll(async () => (await (await request.get("/api/state")).json()).state).toMatchObject({
    status: "completed",
    phase: 10,
    artifacts: expect.arrayContaining(["senior-review-round-1.md", "senior-review-round-2.md", "mr-description.md"]),
    agents: expect.arrayContaining([
      expect.objectContaining({ name: "developer", status: "completed" }),
      expect.objectContaining({ name: "senior-reviewer", status: "completed" }),
    ]),
  });
});
