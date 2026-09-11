import { expect, test } from "@playwright/test";
import { resetRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

/**
 * Every reviewer overwrites its own evidence file on each round, so the list of
 * artifacts is identical from one round to the next: the badge is raised on the
 * write stamp, and reading the tab is what clears it.
 */
test("should flag new evidence on the tab, and stop flagging it once read", async ({ page }) => {
  await page.goto("/?demo=1");
  const badge = page.getByRole("img", { name: "nouvelles preuves" });
  const evidenceTab = page.getByRole("tab", { name: "Preuves" });

  // Nothing has been written yet, so there is nothing to flag.
  await expect(badge).toBeHidden();

  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Garder les alertes critiques" }).click();
  await page.getByRole("button", { name: "Transmettre à Claude" }).click();

  await expect(badge).toBeVisible();
  await evidenceTab.click();
  await expect(badge).toBeHidden();

  // Back on another tab, what was read stays read.
  await page.getByRole("tab", { name: "Conversation" }).click();
  await expect(badge).toBeHidden();
});

test("should flag again when a later round rewrites the same file", async ({ page }) => {
  await page.goto("/?demo=1");
  const badge = page.getByRole("img", { name: "nouvelles preuves" });

  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Garder les alertes critiques" }).click();
  await page.getByRole("button", { name: "Transmettre à Claude" }).click();

  // Read the first write, then leave the tab.
  await expect(badge).toBeVisible();
  await page.getByRole("tab", { name: "Preuves" }).click();
  await expect(badge).toBeHidden();
  await page.getByRole("tab", { name: "Conversation" }).click();

  // The demo writes evidence a second time, as a review round would.
  await expect(page.getByText("Démonstration terminée", { exact: true })).toBeVisible();
  await expect(badge).toBeVisible();
});

/**
 * The badge would be a lie on its own: the panel fetched each evidence file
 * once and its effect watched nothing that a rewrite changes, so the tab kept
 * showing the findings of the first round.
 */
test("should read the evidence file again when it is written a second time", async ({ page }) => {
  const reads: string[] = [];
  await page.route("**/api/artifacts?path=*", async (route) => {
    reads.push(new URL(route.request().url()).searchParams.get("path") ?? "");
    await route.continue();
  });

  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Garder les alertes critiques" }).click();
  await page.getByRole("button", { name: "Transmettre à Claude" }).click();
  await expect(page.getByText("Démonstration terminée", { exact: true })).toBeVisible();

  // dev-evidence.json is written at one step and the stamp moves again at a
  // later one, exactly the shape of a review round overwriting its own file.
  await expect(async () => {
    expect(reads.filter((path) => path === "dev-evidence.json").length).toBeGreaterThan(1);
  }).toPass({ timeout: 5_000 });
});

test("should flag a new message on the Conversation tab, and clear it on reading", async ({ page }) => {
  await page.goto("/?demo=1");
  const badge = page.getByRole("img", { name: "nouveau message" });

  // Scoped to the dialogue: the demo writes the same line to the terminal too,
  // and xterm renders it into the DOM.
  const conversation = page.getByRole("log", { name: "Conversation" });
  // The first message lands while the Conversation tab is the one being read.
  await expect(conversation.getByText("Lecture du ticket GitLab simulé…")).toBeVisible();
  await expect(badge).toBeHidden();

  await page.getByRole("tab", { name: "Terminal" }).click();
  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Garder les alertes critiques" }).click();
  await page.getByRole("button", { name: "Transmettre à Claude" }).click();

  await expect(badge).toBeVisible();
  await page.getByRole("tab", { name: "Conversation" }).click();
  await expect(badge).toBeHidden();
});

test("should not flag the dialogue for an instruction the user typed", async ({ page }) => {
  await page.goto("/?demo=1");
  await expect(page.getByRole("log", { name: "Conversation" }).getByText("Lecture du ticket GitLab simulé…")).toBeVisible();

  await page.getByLabel("Instruction pour Claude").fill("reste sur desktop");
  await page.getByRole("button", { name: "Envoyer l’instruction" }).click();
  await page.getByRole("tab", { name: "Terminal" }).click();

  // The demo answers, and that answer is news; the instruction itself was not.
  await expect(page.getByRole("img", { name: "nouveau message" })).toBeVisible();
});

test("should keep the tab bar aligned when a dot appears on the first tab", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("tab", { name: "Terminal" }).click();
  await expect(page.getByRole("img", { name: "nouveau message" })).toBeVisible();

  // Conversation is the first tab, so its dot shifts every button after it.
  // The pill slides there over a 200ms CSS transition, so retry until it settles.
  await expect(async () => {
    const geometry = await page.evaluate(() => {
      const list = document.querySelector('[role="tablist"]');
      const pill = list?.querySelector("span.absolute");
      const selected = list?.querySelector('[aria-selected="true"]');
      return {
        pillLeft: pill?.getBoundingClientRect().left ?? 0,
        selectedLeft: selected?.getBoundingClientRect().left ?? 0,
        pillWidth: Math.round(pill?.getBoundingClientRect().width ?? 0),
        selectedWidth: Math.round(selected?.getBoundingClientRect().width ?? 0),
      };
    });
    expect(geometry.pillWidth).toBe(geometry.selectedWidth);
    expect(Math.abs(geometry.pillLeft - geometry.selectedLeft)).toBeLessThan(2);
  }).toPass({ timeout: 2_000 });
});

test("should never flag the tab the user is already reading", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("tab", { name: "Preuves" }).click();

  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Garder les alertes critiques" }).click();
  await page.getByRole("button", { name: "Transmettre à Claude" }).click();
  await expect(page.getByText("Démonstration terminée", { exact: true })).toBeVisible();

  await expect(page.getByRole("img", { name: "nouvelles preuves" })).toBeHidden();
});
