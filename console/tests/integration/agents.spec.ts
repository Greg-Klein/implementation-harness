import { expect, test } from "@playwright/test";
import { resetRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

test("should stop showing an agent as active once the run is over", async ({ page }) => {
  await page.goto("/?demo=1");
  await expect(page.getByText("Décision requise")).toBeVisible();
  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Garder les alertes critiques" }).click();
  await page.getByRole("button", { name: "Transmettre à Claude" }).click();

  const agents = page.getByRole("region", { name: "Agents" });
  await expect(agents.getByText("1 actif", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Arrêter" }).click();

  await expect(page.getByText("Un agent n'a jamais rapporté sa fin")).toBeVisible();
  await expect(agents).toBeHidden();
});
