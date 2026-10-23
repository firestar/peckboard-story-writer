// A minimal JSON-schema-subset validator. Supports exactly the shapes the
// tool schemas in src/schemas.ts use (type, properties, required,
// additionalProperties, items, enum, minimum, minLength) — enough to give
// worker tool calls a clear error message without pulling in a JSON-schema
// library the wasm bundle would have to carry.

export interface Schema {
  type?: "object" | "array" | "string" | "integer" | "number" | "boolean";
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  enum?: readonly unknown[];
  minimum?: number;
  minLength?: number;
  description?: string;
}

function typeOf(v: unknown): string {
  if (Array.isArray(v)) return "array";
  if (v === null) return "null";
  if (typeof v === "number" && Number.isInteger(v)) return "integer";
  return typeof v;
}

function matchesType(v: unknown, t: Schema["type"]): boolean {
  if (!t) return true;
  if (t === "integer") return typeof v === "number" && Number.isInteger(v);
  if (t === "number") return typeof v === "number";
  return typeOf(v) === t;
}

/// Validate `value` against `schema`; throws a descriptive `Error` on the
/// first violation found. `path` is prefixed to every message.
export function validate(schema: Schema, value: unknown, path = "args"): void {
  if (schema.enum && !schema.enum.includes(value as any)) {
    throw new Error(`${path}: must be one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`);
  }
  if (schema.type && !matchesType(value, schema.type)) {
    throw new Error(`${path}: expected ${schema.type}, got ${typeOf(value)}`);
  }
  if (schema.type === "string" && typeof value === "string" && schema.minLength !== undefined) {
    if (value.length < schema.minLength) {
      throw new Error(`${path}: must be at least ${schema.minLength} characters`);
    }
  }
  if ((schema.type === "integer" || schema.type === "number") && typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      throw new Error(`${path}: must be >= ${schema.minimum}`);
    }
  }
  if (schema.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj) || obj[key] === undefined) {
        throw new Error(`${path}.${key}: required`);
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(obj)) {
        if (!allowed.has(key)) {
          throw new Error(`${path}.${key}: unknown property`);
        }
      }
    }
    for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
      if (obj[key] !== undefined) {
        validate(propSchema, obj[key], `${path}.${key}`);
      }
    }
  }
  if (schema.type === "array" && Array.isArray(value) && schema.items) {
    value.forEach((item, i) => validate(schema.items as Schema, item, `${path}[${i}]`));
  }
}
