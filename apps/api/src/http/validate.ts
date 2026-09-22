import type { ZodTypeAny, z } from "zod";
import { Errors } from "../lib/errors.js";

export function parse<S extends ZodTypeAny>(schema: S, data: unknown, where = "body"): z.infer<S> {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
      code: i.code,
    }));
    const first = details[0];
    throw Errors.validation(first ? `${where}.${first.path || "?"}: ${first.message}` : `Invalid ${where}`, details, first?.path);
  }
  return result.data;
}

export function parseQuery<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  return parse(schema, data, "query");
}
