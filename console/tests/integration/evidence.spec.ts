import { expect, test } from "@playwright/test";
import { resetRun, runDemoToCompletion } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

test("should enlarge an evidence screenshot without leaving the console", async ({ page }) => {
  await runDemoToCompletion(page);
  await page.getByRole("tab", { name: "Preuves" }).click();

  await expect(page.getByText("Lint", { exact: true })).toBeVisible();
  await expect(page.getByText("Aucune preuve écrite pour ce run.")).toHaveCount(1);

  await page.getByRole("button", { name: "Agrandir la capture assets/panneau-preferences.png" }).click();
  const lightbox = page.getByRole("dialog", { name: "assets/panneau-preferences.png" });
  await expect(lightbox.getByRole("img", { name: "assets/panneau-preferences.png" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(lightbox).toBeHidden();
});
