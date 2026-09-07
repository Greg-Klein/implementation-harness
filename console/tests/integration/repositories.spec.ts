import { expect, test } from "@playwright/test";
import { sampleCheckout, sampleProject } from "../fixtures";
import { resetRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

test("should detect and fill a repository from the GitLab issue URL", async ({ page, request }) => {
  const issueUrl = `https://gitlab.com/${sampleProject}/-/issues/42`;
  await page.getByLabel("Ticket GitLab").fill(issueUrl);

  await expect(page.getByLabel(/Répertoire du projet/)).toHaveValue(sampleCheckout);
  await expect(page.getByText(`Projet · ${sampleProject}`)).toBeVisible();

  const response = await request.get(`/api/repositories?issueUrl=${encodeURIComponent(issueUrl)}`);
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({
    detected: { project: sampleProject, path: sampleCheckout, exists: true, source: "git" },
    repositories: expect.arrayContaining([expect.objectContaining({ project: sampleProject, path: sampleCheckout, exists: true })]),
  });
});
