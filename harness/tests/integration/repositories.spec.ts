import { expect, test } from "@playwright/test";
import { resetRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

test("should detect and fill a repository from the GitLab issue URL", async ({ page, request }) => {
  const issueUrl = "https://gitlab.com/group/repo/-/issues/42";
  await page.getByLabel("Ticket GitLab").fill(issueUrl);

  await expect(page.getByLabel(/Répertoire du projet/)).toHaveValue(".");
  await expect(page.getByText("Projet · group/repo")).toBeVisible();

  const response = await request.get(`/api/repositories?issueUrl=${encodeURIComponent(issueUrl)}`);
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({
    detected: { project: "group/repo", path: ".", exists: true, source: "env" },
    repositories: expect.arrayContaining([expect.objectContaining({ project: "group/repo", path: ".", exists: true })]),
  });
});
