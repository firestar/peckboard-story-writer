// A stand-in for the Extism host boundary (same shape as project-planner's /
// graphify's), so the tests can drive real plugin code paths
// (`Host.getFunctions()` + `Memory`). Importing this module installs the
// fake; each test then declares only the host functions it cares about.

const memory = new Map<bigint, string>();
let nextOffset = 1n;

/// Every host call the code under test made, in order.
export const hostCalls: { name: string; input: any }[] = [];

let handlers: Record<string, (input: any) => unknown> = {};

function alloc(text: string): bigint {
  const offset = nextOffset++;
  memory.set(offset, text);
  return offset;
}

(globalThis as any).Memory = {
  fromString: (s: string) => ({ offset: alloc(s) }),
  find: (offset: bigint) => ({ readString: () => memory.get(offset) ?? "" }),
};

(globalThis as any).Host = {
  getFunctions: () =>
    new Proxy(
      {},
      {
        get: (_target, name: string) => (offset: bigint) => {
          const input = JSON.parse(memory.get(offset) ?? "{}");
          hostCalls.push({ name, input });
          return alloc(JSON.stringify(handlers[name] ? handlers[name](input) : {}));
        },
      },
    ),
};

/// Replace the declared host functions and clear the call log.
export function setHandlers(next: Record<string, (input: any) => unknown>): void {
  handlers = next;
  hostCalls.length = 0;
}

/// UTF-8 byte length, matching core's size check (`data.len()` on the
/// serialized JSON — see peckboard src/plugin/host.rs `encode_doc`).
function byteLen(s: string): number {
  let len = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x80) len += 1;
    else if (code < 0x800) len += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      len += 4;
      i++;
    } else len += 3;
  }
  return len;
}

/// Max serialized size of one stored document, matching core's
/// `PLUGIN_DOC_MAX_BYTES` (peckboard src/plugin/host.rs) — so tests that
/// exercise src/store.ts's chunking actually prove it stays under the real
/// cap, rather than just under some fake-host-only limit.
export const MAX_DOC_BYTES = 256 * 1024;

/// Host functions for the plugin document store, backed by a plain object.
/// Keys are `<collection>/<key>`. Enforces the same size/identifier limits
/// core does (`validate_id` / `encode_doc` in host.rs) so a store.ts bug
/// that writes an oversized doc fails the test instead of silently working
/// only against this fake.
export function docStore(seed: Record<string, unknown> = {}): {
  docs: Record<string, unknown>;
  handlers: Record<string, (input: any) => unknown>;
} {
  const docs: Record<string, unknown> = { ...seed };
  return {
    docs,
    handlers: {
      peckboard_store_get: ({ collection, key }: any) => ({
        value: docs[`${collection}/${key}`] ?? null,
      }),
      peckboard_store_put: ({ collection, key, data }: any) => {
        if (!collection || !key) return { error: "collection and key must not be empty" };
        if (collection.length > 256 || key.length > 256) return { error: "collection/key exceeds 256 bytes" };
        const size = byteLen(JSON.stringify(data));
        if (size > MAX_DOC_BYTES) return { error: `data exceeds ${MAX_DOC_BYTES} bytes` };
        docs[`${collection}/${key}`] = data;
        return { ok: true };
      },
      peckboard_store_list: ({ collection }: any) => ({
        items: Object.entries(docs)
          .filter(([k]) => k.startsWith(`${collection}/`))
          .map(([k, value]) => ({ key: k.slice(collection.length + 1), value })),
      }),
      peckboard_store_delete: ({ collection, key }: any) => {
        delete docs[`${collection}/${key}`];
        return { ok: true };
      },
    },
  };
}

/// Fixed caller scope, for tests of project-scoped tools/routes.
export function callerScope(projectId: string | null = "proj-1"): Record<string, (input: any) => unknown> {
  return {
    peckboard_caller_scope: () => ({
      folder_id: projectId ? "folder-1" : null,
      project_id: projectId,
      session_id: projectId ? "session-1" : null,
      authority: false,
    }),
  };
}

/// Host functions for `project_files_write` (`peckboard_write_file`),
/// recording every written path/content pair.
export function fileWrites(): {
  files: Record<string, string>;
  handlers: Record<string, (input: any) => unknown>;
} {
  const files: Record<string, string> = {};
  return {
    files,
    handlers: {
      peckboard_write_file: ({ path, content, append }: any) => {
        files[path] = append ? (files[path] ?? "") + content : content;
        return { ok: true, path, bytes_written: content.length, appended: !!append };
      },
    },
  };
}

/// A fake card, shaped like `src/host.ts`'s `Card`.
export interface FakeCard {
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
}

let fakeCardSeq = 0;

/// Host functions for `peckboard_list_cards` / `peckboard_create_card` /
/// `peckboard_update_card`, backed by a plain array. `setStep` is a test
/// shorthand for simulating a worker/human moving a card to `done` or
/// `wont_do` before firing the matching `card.step.after` event.
export function fakeCards(seed: FakeCard[] = []): {
  cards: FakeCard[];
  setStep: (id: string, step: string) => void;
  handlers: Record<string, (input: any) => unknown>;
} {
  const cards: FakeCard[] = seed.slice();
  const setStep = (id: string, step: string): void => {
    const card = cards.find((c) => c.id === id);
    if (card) card.step = step;
  };
  return {
    cards,
    setStep,
    handlers: {
      peckboard_list_cards: ({ project_id, step }: any) => ({
        cards: cards.filter((c) => (!project_id || c.project_id === project_id) && (!step || c.step === step)),
      }),
      peckboard_create_card: (input: any) => {
        if (!input?.title || !String(input.title).trim()) return { error: "title is required" };
        const card: FakeCard = {
          id: `card-${++fakeCardSeq}`,
          project_id: input.project_id,
          title: input.title,
          description: input.description ?? "",
          step: input.step ?? "backlog",
          priority: input.priority ?? 2,
          workflow: input.workflow ?? "task",
          model: input.model ?? null,
          effort: input.effort ?? null,
          blocked: input.blocked ?? !!input.block_reason,
          block_reason: input.block_reason ?? null,
        };
        cards.push(card);
        return { card };
      },
      peckboard_update_card: (input: any) => {
        const card = cards.find((c) => c.id === input.card_id);
        if (!card) return { error: "card not found" };
        if (input.description !== undefined) card.description = input.description;
        if (input.step !== undefined) card.step = input.step;
        if (input.priority !== undefined) card.priority = input.priority;
        if (input.model !== undefined) card.model = input.model;
        if (input.blocked !== undefined) card.blocked = input.blocked;
        if (input.block_reason !== undefined) card.block_reason = input.block_reason;
        return { card };
      },
    },
  };
}

/// Host function for `peckboard_get_plugin_setting`, backed by a plain
/// key -> value map.
export function pluginSettings(values: Record<string, unknown> = {}): Record<string, (input: any) => unknown> {
  return {
    peckboard_get_plugin_setting: ({ key }: any) => ({ value: values[key] ?? null }),
  };
}
