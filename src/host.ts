// FFI layer: the Peckboard core host functions this plugin calls, and the
// host_call marshaling helper. Host calls are kept LAZY (inside functions) so
// the pure modules load under vitest without an Extism runtime.
//
// KEEP IN SYNC with src/index.d.ts — an undeclared host call traps at runtime.

type HostFn = (offset: I64) => I64;

/// Call a host function and parse its JSON response, surfacing an
/// `{"error": ...}` envelope (or a trap) as a thrown Error.
export function hostCall(name: string, input: unknown): any {
  const f = (Host.getFunctions() as Record<string, HostFn>)[name];
  const mem = Memory.fromString(JSON.stringify(input));
  const out = f(mem.offset);
  const parsed = JSON.parse(Memory.find(out).readString());
  if (parsed && parsed.error !== undefined && parsed.error !== null) {
    throw new Error(String(parsed.error));
  }
  return parsed;
}

// ── Plugin document store (data_store permission) ────────────────────────────
// Keys are namespaced `<collection>/<key>` by core; callers pick a collection
// per document kind (e.g. "brief", "records", "chapter") and key by project id
// (plus a sub-id for per-chapter docs), per the ≤256 KB-per-doc limit — split
// large docs across multiple keys rather than growing one.

export function storePut(collection: string, key: string, data: unknown): void {
  hostCall("peckboard_store_put", { collection, key, data });
}

export function storeGet(collection: string, key: string): any {
  const result = hostCall("peckboard_store_get", { collection, key });
  return result?.value ?? null;
}

export function storeList(collection: string): { key: string; value: unknown }[] {
  const result = hostCall("peckboard_store_list", { collection });
  return result?.items ?? [];
}

export function storeDelete(collection: string, key: string): void {
  hostCall("peckboard_store_delete", { collection, key });
}

// ── Caller scope ─────────────────────────────────────────────────────────────

/// The folder/project/session this call is running in, as core resolved it:
/// the verified MCP invocation scope, or the scope of the authenticated page
/// request. `{folder_id: null, ...}` when the plugin is in neither.
export function callerScope(): {
  folder_id: string | null;
  project_id: string | null;
  session_id: string | null;
  authority: boolean;
} {
  return hostCall("peckboard_caller_scope", {});
}

/// The project id of the current caller, per core's verified scope. Every
/// story_* tool and UI route is project-scoped; throws when called outside
/// one (e.g. a global chat session with no project attached).
export function requireProjectId(): string {
  const scope = callerScope();
  if (!scope.project_id) {
    throw new Error("story-writer requires a project-scoped caller (no project_id in scope)");
  }
  return scope.project_id;
}

// ── Models (models_read permission) ─────────────────────────────────────────

export interface ModelChoice {
  id: string;
  display_name: string;
  provider: string;
  account_id: string | null;
  thinking: boolean;
  tier: number;
}

export function listModels(): ModelChoice[] {
  const result = hostCall("peckboard_list_models", {});
  return result?.models ?? [];
}

// ── Plugin settings (own settings, read back by key) ─────────────────────────

export function getPluginSetting(key: string): unknown {
  const result = hostCall("peckboard_get_plugin_setting", { key });
  return result?.value ?? null;
}

// ── Cards (free to list/create; cards_write to update) ───────────────────────

export interface Card {
  id: string;
  project_id: string;
  title: string;
  description: string;
  step: string;
  priority: number;
  workflow: string;
  model: string | null;
  effort: string | null;
  blocked: boolean;
  block_reason: string | null;
  [key: string]: unknown;
}

export interface CreateCardInput {
  project_id: string;
  title: string;
  description?: string;
  step?: string;
  priority?: number;
  workflow?: string;
  model?: string;
  effort?: string;
  blocked?: boolean;
  block_reason?: string;
}

export function listCards(projectId?: string, step?: string): Card[] {
  const input: any = {};
  if (projectId) input.project_id = projectId;
  if (step) input.step = step;
  const result = hostCall("peckboard_list_cards", input);
  return result?.cards ?? [];
}

export function createCard(input: CreateCardInput): Card {
  const result = hostCall("peckboard_create_card", input);
  if (!result?.card) {
    throw new Error("card creation returned no card");
  }
  return result.card;
}

export interface UpdateCardInput {
  card_id: string;
  title?: string;
  description?: string;
  step?: string;
  priority?: number;
  model?: string;
  effort?: string;
  blocked?: boolean;
  block_reason?: string;
}

/// Update an existing card's fields (needs the `cards_write` permission).
export function updateCard(input: UpdateCardInput): Card {
  const result = hostCall("peckboard_update_card", input);
  if (!result?.card) {
    throw new Error("card update returned no card");
  }
  return result.card;
}

// ── Project files (project_files_read / project_files_write) ────────────────

/// Read one UTF-8 text file under the caller's folder; null when missing.
export function readFileOrNull(path: string): string | null {
  try {
    const result = hostCall("peckboard_read_file", { path });
    return typeof result?.content === "string" ? result.content : null;
  } catch (_e) {
    return null;
  }
}

/// Write one UTF-8 text file under the caller's folder (jailed by core).
/// Parent dirs are created — story files live under `story/`.
/// Core only allows this during a tool invocation, never from a page route.
export function writeFile(path: string, content: string): void {
  hostCall("peckboard_write_file", { path, content, create_dirs: true });
}

export function listProjectFiles(): string[] {
  const result = hostCall("peckboard_list_project_files", {});
  return result?.files ?? [];
}
