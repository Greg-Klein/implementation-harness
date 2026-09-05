import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const pluginRoot = path.resolve(process.cwd(), "..");

function definitions(directory: "agents" | "commands") {
  return readdirSync(path.join(pluginRoot, directory))
    .filter((file) => file.endsWith(".md"))
    .map((file) => path.join(pluginRoot, directory, file));
}

function frontmatter(file: string) {
  const source = readFileSync(file, "utf8");
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  expect(match).not.toBeNull();
  return parse(match?.[1] ?? "") as Record<string, unknown>;
}

describe("Claude Code plugin metadata", () => {
  it("should parse every agent and command frontmatter", () => {
    for (const file of [...definitions("agents"), ...definitions("commands")]) {
      const metadata = frontmatter(file);
      expect(metadata.name).toEqual(expect.any(String));
      expect(metadata.description).toEqual(expect.any(String));
    }
  });

  it("should identify Gregory Klein as the plugin author", () => {
    const manifest = JSON.parse(readFileSync(path.join(pluginRoot, ".claude-plugin/plugin.json"), "utf8"));
    expect(manifest.author).toEqual({ name: "Gregory Klein" });
  });
});
