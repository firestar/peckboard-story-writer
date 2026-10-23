import { describe, expect, it } from "vitest";
import { manifestJson } from "../src/manifest";
import { RECORD_ITEM_SCHEMAS, SCHEMAS } from "../src/schemas";
import { RECORD_ID_KEY, RECORD_REQUIRED_FIELDS, RECORD_SECTIONS } from "../src/types";
import type { Schema } from "../src/validate";

const manifest = JSON.parse(manifestJson());

// Every required field must be declared, recursively — a required field
// missing from `properties` would be unsatisfiable under
// additionalProperties:false and undocumented otherwise.
function checkRequiredDeclared(schema: Schema, path: string): void {
  for (const field of schema.required ?? []) {
    expect(schema.properties ?? {}, `${path}.${field}`).toHaveProperty(field);
  }
  for (const [key, sub] of Object.entries(schema.properties ?? {})) checkRequiredDeclared(sub, `${path}.${key}`);
  if (schema.items) checkRequiredDeclared(schema.items, `${path}[]`);
}

describe("tool schemas", () => {
  it("the manifest declares exactly the schemas tools.ts enforces", () => {
    expect(manifest.mcp_tools.map((t: any) => t.name)).toEqual(Object.keys(SCHEMAS));
    for (const tool of manifest.mcp_tools) {
      expect(tool.input_schema).toEqual(JSON.parse(JSON.stringify((SCHEMAS as any)[tool.name])));
      expect(tool.worker_allowed).toBe(true);
    }
  });

  it("closes every tool's top-level args and declares every required field", () => {
    for (const [name, schema] of Object.entries(SCHEMAS)) {
      expect((schema as Schema).additionalProperties, name).toBe(false);
      checkRequiredDeclared(schema as Schema, name);
    }
  });

  it("has an item schema per record section requiring its identity field", () => {
    expect(Object.keys(RECORD_ITEM_SCHEMAS)).toEqual([...RECORD_SECTIONS]);
    for (const section of RECORD_SECTIONS) {
      const schema = RECORD_ITEM_SCHEMAS[section];
      expect(schema.required).toEqual([RECORD_ID_KEY[section]]);
      expect(schema.additionalProperties).toBeUndefined(); // items stay open-ended
      for (const field of RECORD_REQUIRED_FIELDS[section]) expect(schema.properties).toHaveProperty(field);
    }
  });
});
