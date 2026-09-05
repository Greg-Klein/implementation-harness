import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { positiveDuration } from "./domain.js";

export const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const pluginRoot = path.resolve(harnessRoot, "..");
try { process.loadEnvFile(path.join(pluginRoot, ".env")); } catch { /* Local mappings are optional. */ }
export const dataRoot = path.join(harnessRoot, "data", "runs");
export const feedbackRoot = path.join(harnessRoot, "data", "feedback", "pending");
export const port = Number(process.env.PORT ?? 3210);
export const hostname = process.env.X_IMPLEMENT_HOST ?? "127.0.0.1";
export const dev = process.env.NODE_ENV !== "production";
export const demoStepDuration = positiveDuration(process.env.X_IMPLEMENT_DEMO_STEP_MS, 5_000);
