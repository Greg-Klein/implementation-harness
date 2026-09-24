import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const brand = path.resolve(import.meta.dirname, "../../brand");
const consoleRoot = path.resolve(import.meta.dirname, "..");
// The sheet reads the console's own tokens, so the image cannot drift from the app.
const tokens = readFileSync(path.join(consoleRoot, "app/globals.css"), "utf8").match(/:root\s*\{[^}]*\}/)?.[0];
if (!tokens) throw new Error("Aucun bloc :root dans globals.css.");
const statusColors = readFileSync(path.join(consoleRoot, "node_modules/tailwindcss/theme.css"), "utf8")
  .match(/--color-(?:amber|red|emerald)-\d+:[^;]+;/g) ?? [];

const browser = await chromium.launch({ headless: true, channel: process.env.CI ? undefined : "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(path.join(brand, "sheet.html")).href);
  await page.addStyleTag({ content: `${tokens}\n:root { ${statusColors.join(" ")} }` });
  await page.evaluate(() => {
    for (const element of document.querySelectorAll("[data-token]"))
      element.textContent = getComputedStyle(document.documentElement).getPropertyValue(element.getAttribute("data-token")).trim();
  });
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".sheet").screenshot({ path: path.join(brand, "brand-sheet.png") });
} finally {
  await browser.close();
}
