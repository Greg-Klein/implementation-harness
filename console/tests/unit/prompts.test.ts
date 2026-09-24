import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPromptStore } from "../../server/prompts";

const agent = "---\nname: developer\ndescription: Implements the plan.\n---\n\n# Developer\n";
let directory: string;
let pluginRoot: string;
let promptsRoot: string;
let store: ReturnType<typeof createPromptStore>;

function write(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), "harness-prompts-"));
  pluginRoot = path.join(directory, "plugin");
  promptsRoot = path.join(directory, "prompts");
  write(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "{\"name\":\"implementation-harness\"}");
  write(path.join(pluginRoot, "hooks", "hooks.json"), "{}");
  write(path.join(pluginRoot, "commands", "implement.md"), "---\nname: implement\ndescription: \"Implement a ticket.\"\n---\n\nSteps\n");
  write(path.join(pluginRoot, "agents", "developer.md"), agent);
  write(path.join(pluginRoot, "skills", "gitlab-tickets", "SKILL.md"), "---\nname: gitlab-tickets\ndescription: Ticket conventions.\n---\n");
  store = createPromptStore({ pluginRoot: () => pluginRoot, promptsRoot });
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

const edit = (id: string, content: string) => store.save({ id, content, revision: store.read(id).revision });

describe("prompt overrides", () => {
  it("should list the system instructions, commands, agents and skills of the plugin", () => {
    expect(store.list().map(({ id, group, name, modified }) => ({ id, group, name, modified }))).toEqual([
      { id: "system.md", group: "system", name: "Instructions système", modified: false },
      { id: "commands/implement.md", group: "command", name: "implement", modified: false },
      { id: "agents/developer.md", group: "agent", name: "developer", modified: false },
      { id: "skills/gitlab-tickets/SKILL.md", group: "skill", name: "gitlab-tickets", modified: false },
    ]);
    expect(store.read("commands/implement.md").description).toBe("Implement a ticket.");
  });

  it("should keep an edit outside the plugin and leave the plugin untouched", () => {
    const edited = agent.replace("# Developer", "# Developer\n\nAlways write tests first.");
    const result = edit("agents/developer.md", edited);
    expect(result.ok).toBe(true);
    expect(readFileSync(path.join(pluginRoot, "agents", "developer.md"), "utf8")).toBe(agent);
    expect(store.read("agents/developer.md")).toMatchObject({ modified: true, drifted: false, content: edited, original: agent });
  });

  it("should refuse ids outside the catalog", () => {
    expect(() => store.read("../secret.md")).toThrow();
    expect(() => store.save({ id: "agents/../../outside.md", content: "x", revision: "" })).toThrow();
    expect(existsSync(path.join(directory, "outside.md"))).toBe(false);
  });

  it("should refuse an edit that would break the plugin metadata", () => {
    expect(edit("agents/developer.md", "# No header")).toMatchObject({ ok: false });
    expect(edit("agents/developer.md", agent.replace("name: developer", "name: coder"))).toMatchObject({ ok: false, message: expect.stringContaining("developer") });
    expect(edit("agents/developer.md", agent.replace("description: Implements the plan.", "description:"))).toMatchObject({ ok: false });
    expect(store.read("agents/developer.md").modified).toBe(false);
  });

  it("should reject a stale edit instead of overwriting a newer one", () => {
    const { revision } = store.read("agents/developer.md");
    expect(edit("agents/developer.md", `${agent}First\n`).ok).toBe(true);
    expect(store.save({ id: "agents/developer.md", content: `${agent}Second\n`, revision })).toMatchObject({ ok: false, conflict: true });
    expect(store.read("agents/developer.md").content).toBe(`${agent}First\n`);
  });

  it("should drop the override when it is reset or matches the original again", () => {
    expect(edit("agents/developer.md", `${agent}More\n`).ok).toBe(true);
    const reset = store.reset({ id: "agents/developer.md", revision: store.read("agents/developer.md").revision });
    expect(reset).toMatchObject({ ok: true, prompt: { modified: false, content: agent } });
    expect(existsSync(path.join(promptsRoot, "agents", "developer.md"))).toBe(false);
    expect(edit("system.md", "Answer in French.").ok).toBe(true);
    expect(edit("system.md", "  \n").ok).toBe(true);
    expect(store.read("system.md").modified).toBe(false);
  });

  it("should flag an override whose original changed afterwards", () => {
    expect(edit("agents/developer.md", `${agent}Mine\n`).ok).toBe(true);
    writeFileSync(path.join(pluginRoot, "agents", "developer.md"), `${agent}Improved\n`);
    expect(store.read("agents/developer.md")).toMatchObject({ modified: true, drifted: true, content: `${agent}Mine\n` });
  });

  it("should launch runs on the plugin itself while nothing is customized", () => {
    const plugin = store.sessionPlugin(path.join(directory, "run", "plugin"));
    expect(plugin).toEqual({ pluginDir: pluginRoot, systemPrompt: undefined, customized: [] });
    expect(existsSync(path.join(directory, "run"))).toBe(false);
  });

  it("should launch runs on a copy of the plugin carrying the overrides", () => {
    expect(edit("agents/developer.md", `${agent}Mine\n`).ok).toBe(true);
    expect(edit("system.md", "  Answer in French.\n").ok).toBe(true);
    const target = path.join(directory, "run", "plugin");
    const plugin = store.sessionPlugin(target);
    expect(plugin).toEqual({ pluginDir: target, systemPrompt: "Answer in French.", customized: ["system.md", "agents/developer.md"] });
    expect(readFileSync(path.join(target, "agents", "developer.md"), "utf8")).toBe(`${agent}Mine\n`);
    expect(existsSync(path.join(target, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(path.join(target, "hooks", "hooks.json"))).toBe(true);
    expect(existsSync(path.join(target, "skills", "gitlab-tickets", "SKILL.md"))).toBe(true);
    expect(existsSync(path.join(target, "system.md"))).toBe(false);
  });

  it("should ignore an override whose prompt left the plugin", () => {
    expect(edit("agents/developer.md", `${agent}Mine\n`).ok).toBe(true);
    rmSync(path.join(pluginRoot, "agents", "developer.md"));
    expect(store.list().some((entry) => entry.id === "agents/developer.md")).toBe(false);
    expect(store.sessionPlugin(path.join(directory, "run", "plugin")).pluginDir).toBe(pluginRoot);
  });
});
