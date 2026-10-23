import { describe, expect, it } from "vitest";
import { manifestJson } from "../src/manifest";

const manifest = JSON.parse(manifestJson());

// Pinned copies of core's allowlists (peckboard src/plugin/manager.rs
// `ALLOWED_HOOKS` / `ALLOWED_PERMISSIONS`). A plugin declaring a hook or
// permission outside these fails to load — keep this list in sync if core's
// allowlist changes.
const ALLOWED_HOOKS = [
  "card.create.before",
  "card.step.after",
  "card.update.before",
  "card.priorities.list",
  "http.request.authed",
  "http.request.before",
  "mcp.config.delete.after",
  "mcp.config.write.after",
  "mcp.config.write.before",
  "mcp.token.issue.after",
  "mcp.token.issue.before",
  "mcp.token.revoke.after",
  "mcp.tool.call.after",
  "mcp.tool.call.before",
  "mcp.tool.call.failed",
  "mcp.tool.invoke",
  "project.paused",
  "provider.interrupt",
  "provider.models",
  "provider.register",
  "provider.send",
  "question.pending",
  "session.agent.ended",
  "session.message.before",
  "session.prehatch.answer",
  "session.prehatch.cancel",
  "session.reference.resolve",
  "session.user.answer",
  "terminal.host.resolve",
  "terminal.hosts.list",
  "timer.tick",
  "todo",
  "worker.blocked",
];

const ALLOWED_PERMISSIONS = [
  "cards_write",
  "ask_user",
  "broadcast",
  "browser_runs_read",
  "contribute_sidebar",
  "data_store",
  "event_append",
  "http_fetch",
  "process_exec",
  "http_request",
  "models_read",
  "process_exec_any",
  "project_files_read",
  "project_files_write",
  "register_provider",
  "provide_mcp_tools",
  "ssh",
  "ssh_keys",
  "session_dispatch",
  "session_control",
  "session_orchestrate",
  "session_read",
  "session_write",
  "session_prompt_write",
  "user_authority",
  "worker_questions",
];

describe("manifest", () => {
  it("carries the required identity fields", () => {
    expect(manifest.description).toBeTruthy();
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.repository).toBe("https://github.com/firestar/peckboard-story-writer");
  });

  it("declares only hooks core dispatches", () => {
    for (const hook of manifest.hooks) {
      expect(ALLOWED_HOOKS).toContain(hook);
    }
    expect(manifest.hooks).toEqual(
      expect.arrayContaining([
        "mcp.tool.invoke",
        "http.request.before",
        "http.request.authed",
        "card.step.after",
        "timer.tick",
      ]),
    );
  });

  it("stays on core's default 2 s call budget", () => {
    expect(manifest.call_timeout_secs ?? 2).toBeLessThanOrEqual(2);
  });

  it("declares only permissions core grants", () => {
    for (const perm of manifest.permissions) {
      expect(ALLOWED_PERMISSIONS).toContain(perm);
    }
    expect(manifest.permissions).toEqual(
      expect.arrayContaining([
        "contribute_sidebar",
        "data_store",
        "cards_write",
        "provide_mcp_tools",
        "project_files_read",
        "project_files_write",
        "models_read",
      ]),
    );
  });

  it("declares matching route shapes", () => {
    expect(manifest.http_routes).toEqual(["GET /plugin-api/v1/story-writer"]);
    for (const route of manifest.ui_routes) {
      expect(route).toMatch(/^(GET|POST) \/api\/plugin-ui\/story-writer\//);
    }
  });

  it("contributes a single project-level Story tab", () => {
    expect(manifest.sidebar_items).toBeUndefined();
    expect(manifest.folder_items).toBeUndefined();
    expect(manifest.session_items).toBeUndefined();
    expect(manifest.project_items).toHaveLength(1);
    expect(manifest.project_items[0]).toMatchObject({
      id: "story-writer",
      label: "Story",
      path: "/plugin-api/v1/story-writer",
    });
  });

  it("declares the six worker tools, each worker_allowed and name-valid", () => {
    const names = manifest.mcp_tools.map((t: any) => t.name);
    expect(names).toEqual([
      "story_get_brief",
      "story_get_records",
      "story_submit_records",
      "story_submit_chapter",
      "story_update_state",
      "story_report_review",
    ]);
    for (const tool of manifest.mcp_tools) {
      expect(tool.name).toMatch(/^[a-z0-9_]{1,64}$/);
      expect(tool.worker_allowed).toBe(true);
      expect(tool.description).toBeTruthy();
      expect(tool.input_schema.type).toBe("object");
    }
  });

  it("requires markdown/chapter on story_submit_chapter", () => {
    const tool = manifest.mcp_tools.find((t: any) => t.name === "story_submit_chapter");
    expect(tool.input_schema.required).toEqual(["chapter", "markdown"]);
  });

  it("requires a verdict enum on story_report_review", () => {
    const tool = manifest.mcp_tools.find((t: any) => t.name === "story_report_review");
    expect(tool.input_schema.properties.verdict.enum).toEqual(["pass", "changes_requested"]);
    expect(tool.input_schema.required).toEqual(["chapter", "pass", "verdict", "notes"]);
  });

  it("declares the writer and reviewer model settings", () => {
    const keys = manifest.settings.map((s: any) => s.key);
    expect(keys).toEqual(["writer_model", "reviewer_model"]);
    for (const field of manifest.settings) {
      expect(field.type).toBe("string");
      expect(field.required).toBeFalsy();
    }
  });
});

// The registry compares its version against what the LOADED wasm manifest
// reports. If the manifest lags package.json, every upgrade "succeeds" but
// the upgrade-available chip never clears.
describe("manifest version source", () => {
  it("matches package.json exactly", async () => {
    const pkg = await import("../package.json");
    expect(manifest.version).toBe(pkg.version);
  });
});
