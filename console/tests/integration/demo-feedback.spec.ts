import { expect, test } from "@playwright/test";
import { resetRun, runDemoToCompletion } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

test("should offer a simulated feedback field once the demonstration ends", async ({ page, request }) => {
  await runDemoToCompletion(page);

  const field = page.getByLabel("Faire progresser le harnais");
  await expect(field).toBeVisible();

  // Les cartes de fin de run se logent dans le panneau, qui absorbe le reste en
  // comprimant le journal : la page elle-meme ne doit jamais defiler.
  const pageOverflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollHeight - root.clientHeight;
  });
  expect(pageOverflow).toBe(0);
  await field.fill("La revue de design manque une vérification de contraste.");
  await page.getByRole("button", { name: "Ajouter à la boucle d’auto-amélioration" }).click();

  // Le panneau est montre en entier, mais rien ne doit rejoindre la file :
  // un retour simule serait ensuite traite comme du vecu par impl improve.
  await expect(page.getByText("Retour simulé. Rien n’a été enregistré.")).toBeVisible();
  await expect(field).toHaveValue("");

  const { state } = await (await request.get("/api/state")).json();
  expect(state.status).toBe("completed");
  expect(state.activities.map((item: { title: string }) => item.title))
    .not.toContain("Retour ajouté à la boucle d’auto-amélioration");
});
