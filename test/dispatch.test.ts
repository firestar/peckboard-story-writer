import { beforeEach, describe, expect, it } from "vitest";
import { callerScope, docStore, hostCalls, setHandlers } from "./fakeHost";
import { dispatch } from "../src/lib";

function allowPayload(raw: string): any {
  const v = JSON.parse(raw);
  expect(v.verdict).toBe("allow");
  return v.payload;
}

function invoke(tool: string, args: unknown = {}): any {
  return allowPayload(dispatch("mcp.tool.invoke", { tool, arguments: args, context: {} }));
}

describe("dispatch: unhandled hooks", () => {
  beforeEach(() => setHandlers({}));

  it("skips a hook this plugin does not listen for", () => {
    expect(dispatch("provider.models", {})).toBe(JSON.stringify({ verdict: "skip" }));
  });

  it("skips card.step.after and timer.tick (stage machine lands later)", () => {
    expect(JSON.parse(dispatch("card.step.after", { card_id: "c1" })).verdict).toBe("skip");
    expect(JSON.parse(dispatch("timer.tick", { now: "2026-01-01T00:00:00Z" })).verdict).toBe("skip");
  });
});

describe("dispatch: mcp.tool.invoke", () => {
  beforeEach(() => setHandlers({ ...docStore().handlers, ...callerScope("proj-1") }));

  it("cancels a call to a tool this plugin does not declare", () => {
    const v = JSON.parse(dispatch("mcp.tool.invoke", { tool: "nope", arguments: {}, context: {} }));
    expect(v.verdict).toBe("cancel");
    expect(v.reason).toMatch(/does not provide tool 'nope'/);
  });

  it("cancels a malformed invoke payload", () => {
    expect(JSON.parse(dispatch("mcp.tool.invoke", null)).verdict).toBe("cancel");
  });

  it("surfaces a scope error as a tool result, not a plugin cancel", () => {
    setHandlers({ ...docStore().handlers, ...callerScope(null) });
    const result = invoke("story_get_brief");
    expect(result.error).toMatch(/project-scoped caller/);
  });

  it("story_get_brief returns null before the wizard has run", () => {
    expect(invoke("story_get_brief")).toEqual({ brief: null });
  });

  it("story_submit_records then story_get_records round-trips", () => {
    expect(invoke("story_submit_records", { records: { characters: [{ name: "Ada" }] } })).toEqual({ ok: true });
    expect(invoke("story_get_records")).toEqual({ records: { characters: [{ name: "Ada" }] } });
  });

  it("story_submit_records merges instead of replacing", () => {
    invoke("story_submit_records", { records: { characters: [{ name: "Ada" }] } });
    invoke("story_submit_records", { records: { glossary: { Ley: "magic grid" } } });
    expect(invoke("story_get_records")).toEqual({
      records: { characters: [{ name: "Ada" }], glossary: { Ley: "magic grid" } },
    });
  });

  it("story_submit_records rejects a missing records object", () => {
    expect(invoke("story_submit_records", {}).error).toMatch(/records/);
  });

  it("story_submit_chapter requires chapter and markdown", () => {
    expect(invoke("story_submit_chapter", { chapter: 0 }).error).toMatch(/markdown/);
    expect(invoke("story_submit_chapter", { markdown: "x" }).error).toMatch(/chapter/);
  });

  it("story_submit_chapter stores the chapter and mirrors it to a file", () => {
    const result = invoke("story_submit_chapter", { chapter: 1, markdown: "# Ch1", recap: "setup" });
    expect(result).toEqual({ ok: true, path: "story/chapters/chapter-01.md" });
    expect(hostCalls.some((c) => c.name === "peckboard_write_file" && c.input.path === "story/chapters/chapter-01.md")).toBe(
      true,
    );
  });

  it("story_update_state merges stage/note/data across calls", () => {
    expect(invoke("story_update_state", { stage: "pilot", note: "drafting" })).toEqual({ ok: true });
    expect(invoke("story_update_state", { data: { chapters_ready: 1 } })).toEqual({ ok: true });
    const brief = allowPayload(dispatch("mcp.tool.invoke", { tool: "story_get_brief", arguments: {}, context: {} }));
    expect(brief).toEqual({ brief: null }); // state is a separate collection from brief
  });

  it("story_report_review rejects a bad verdict", () => {
    expect(invoke("story_report_review", { chapter: 1, pass: "line", verdict: "nope", notes: "x" }).error).toMatch(
      /verdict/,
    );
  });

  it("story_report_review with changes_requested appends to the brief's style_rules", () => {
    expect(invoke("story_report_review", { chapter: 2, pass: "line", verdict: "changes_requested", notes: "cut the filler" })).toEqual(
      { ok: true },
    );
    expect(invoke("story_get_brief")).toEqual({
      brief: { style_rules: ["[chapter 2, line review] cut the filler"] },
    });
  });

  it("story_report_review with a pass verdict does not touch the brief", () => {
    invoke("story_report_review", { chapter: 1, pass: "copyedit", verdict: "pass", notes: "clean" });
    expect(invoke("story_get_brief")).toEqual({ brief: null });
  });
});

describe("dispatch: http.request.before (public page)", () => {
  beforeEach(() => setHandlers({}));

  it("serves the Story tab page", () => {
    const resp = JSON.parse(dispatch("http.request.before", { method: "GET", path: "/plugin-api/v1/story-writer" }));
    expect(resp.verdict).toBe("allow");
    expect(resp.payload.status).toBe(200);
    expect(resp.payload.body).toContain("Story Writer");
  });

  it("404s an unknown path", () => {
    const resp = JSON.parse(dispatch("http.request.before", { method: "GET", path: "/plugin-api/v1/nope" }));
    expect(resp.payload.status).toBe(404);
  });
});

describe("dispatch: http.request.authed (project UI routes)", () => {
  beforeEach(() => setHandlers({ ...docStore().handlers, ...callerScope("proj-1") }));

  it("400s outside a project scope", () => {
    setHandlers({ ...docStore().handlers, ...callerScope(null) });
    const resp = JSON.parse(
      dispatch("http.request.authed", { method: "GET", path: "/api/plugin-ui/story-writer/state" }),
    );
    expect(resp.payload.status).toBe(400);
  });

  it("GET state reflects what story_submit_records/wizard wrote", () => {
    dispatch("http.request.authed", {
      method: "POST",
      path: "/api/plugin-ui/story-writer/wizard",
      body: JSON.stringify({ brief: { title: "Ashwood" } }),
    });
    const resp = JSON.parse(
      dispatch("http.request.authed", { method: "GET", path: "/api/plugin-ui/story-writer/state" }),
    );
    const body = JSON.parse(resp.payload.body);
    expect(body).toEqual({
      project_id: "proj-1",
      brief: { title: "Ashwood" },
      records: {},
      pipeline: { stage: "setup" },
    });
  });

  it("GET models returns an empty list when the host declares none", () => {
    const resp = JSON.parse(
      dispatch("http.request.authed", { method: "GET", path: "/api/plugin-ui/story-writer/models" }),
    );
    expect(JSON.parse(resp.payload.body)).toEqual({ models: [] });
  });

  it("404s an unknown authed path", () => {
    const resp = JSON.parse(
      dispatch("http.request.authed", { method: "GET", path: "/api/plugin-ui/story-writer/nope" }),
    );
    expect(resp.payload.status).toBe(404);
  });
});
