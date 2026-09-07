import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { positiveDuration } from "./domain.js";

export const consoleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const pluginRoot = path.resolve(consoleRoot, "..");
const envFile = process.env.IMPL_ENV_FILE ?? path.join(pluginRoot, ".env");
try {
  process.loadEnvFile(envFile);
} catch (error) {
  // A missing .env is the normal case; anything else means the file is there
  // but unusable, and staying silent would hide a broken configuration.
  if (existsSync(envFile)) console.warn(`Configuration ignorée, ${envFile} est illisible : ${error instanceof Error ? error.message : error}`);
}
export const dataRoot = path.join(consoleRoot, "data", "runs");
export const feedbackRoot = path.join(consoleRoot, "data", "feedback", "pending");
export const port = Number(process.env.PORT ?? process.env.IMPL_PORT ?? 3210);
export const hostname = process.env.IMPL_HOST ?? "127.0.0.1";
export const dev = process.env.NODE_ENV !== "production";
export const demoStepDuration = positiveDuration(process.env.IMPL_DEMO_STEP_MS, 5_000);
