/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";

export type JsonSchema = Record<string, any>;

/**
 * Minimal Zod -> JSON Schema converter.
 *
 * The Python agent layer builds Pydantic models from these schemas, so the Zod
 * definition on the TypeScript side stays the single source of truth for every
 * tool's contract. Hand-rolled rather than pulled from npm because it only has
 * to cover the constructs our tool schemas actually use, and a tool schema is
 * something we want to keep deliberately simple.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const def: any = (schema as any)._def;
  const described = (out: JsonSchema): JsonSchema =>
    def.description ? { ...out, description: def.description } : out;

  switch (def.typeName) {
    case "ZodString": {
      const out: JsonSchema = { type: "string" };
      for (const check of def.checks ?? []) {
        if (check.kind === "min") out.minLength = check.value;
        if (check.kind === "max") out.maxLength = check.value;
        if (check.kind === "email") out.format = "email";
        if (check.kind === "url") out.format = "uri";
        if (check.kind === "uuid") out.format = "uuid";
        if (check.kind === "regex") out.pattern = String(check.regex).replace(/^\/|\/[a-z]*$/g, "");
      }
      return described(out);
    }
    case "ZodNumber": {
      const out: JsonSchema = { type: def.checks?.some((c: any) => c.kind === "int") ? "integer" : "number" };
      for (const check of def.checks ?? []) {
        if (check.kind === "min") out.minimum = check.value;
        if (check.kind === "max") out.maximum = check.value;
      }
      return described(out);
    }
    case "ZodBoolean":
      return described({ type: "boolean" });
    case "ZodDate":
      return described({ type: "string", format: "date-time" });
    case "ZodLiteral":
      return described({ const: def.value });
    case "ZodEnum":
      return described({ type: "string", enum: [...def.values] });
    case "ZodNativeEnum":
      return described({ enum: Object.values(def.values) });
    case "ZodArray":
      return described({ type: "array", items: zodToJsonSchema(def.type) });
    case "ZodObject": {
      const shape = def.shape();
      const properties: JsonSchema = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value as z.ZodTypeAny);
        if (!isOptional(value as z.ZodTypeAny)) required.push(key);
      }
      return described({
        type: "object",
        properties,
        ...(required.length ? { required } : {}),
        additionalProperties: false,
      });
    }
    case "ZodRecord":
      return described({ type: "object", additionalProperties: zodToJsonSchema(def.valueType) });
    case "ZodUnion": {
      const options = def.options.map((o: z.ZodTypeAny) => zodToJsonSchema(o));
      // A union of string literals is far more useful to an LLM as an enum.
      if (options.every((o: JsonSchema) => "const" in o && typeof o.const === "string")) {
        return described({ type: "string", enum: options.map((o: JsonSchema) => o.const) });
      }
      return described({ anyOf: options });
    }
    case "ZodOptional":
    case "ZodNullable":
      return zodToJsonSchema(def.innerType);
    case "ZodDefault": {
      const inner = zodToJsonSchema(def.innerType);
      return described({ ...inner, default: def.defaultValue() });
    }
    case "ZodEffects":
      return zodToJsonSchema(def.schema);
    case "ZodAny":
    case "ZodUnknown":
    default:
      return described({});
  }
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const name = (schema as any)._def?.typeName;
  return name === "ZodOptional" || name === "ZodDefault" || schema.isOptional?.() === true;
}
