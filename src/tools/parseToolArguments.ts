import { z } from 'zod';

import type { ToolSchema } from './types.ts';

/**
 * The validated arguments, or the message to give back.
 */
export type ToolArgumentsParse<Arguments> =
  { success: true; data: Arguments } | { success: false; error: string };

/**
 * Validate the arguments a model or a client gave a tool: a parameter set to
 * null is left out, a single value under another name is moved to a tool's
 * only parameter (small models rename it), and anything else that does not
 * fit the strict schema is refused with zod's explanation and the list of
 * parameters.
 * @param tool - The tool's name and schema.
 * @param tool.name - The tool's name, for the message.
 * @param tool.schema - Its schema: strict, or loose for a forwarded tool.
 * @param parameters - The arguments as received.
 * @returns The validated arguments, or the message to give back.
 */
export function parseToolArguments<Schema extends ToolSchema>(
  tool: { name: string; schema: Schema },
  parameters: unknown,
): ToolArgumentsParse<z.output<Schema>> {
  const { name, schema } = tool;
  const expected = `Expected parameters: ${Object.keys(schema.shape).join(', ')}.`;
  if (
    typeof parameters !== 'object' ||
    parameters === null ||
    Array.isArray(parameters)
  ) {
    return {
      success: false,
      error: `Invalid arguments for ${name}: give the parameters as an object. ${expected}`,
    };
  }
  const given: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== null) given[key] = value;
  }
  const parsed = schema.safeParse(normalizeToolArguments(schema, given));
  if (parsed.success) {
    return { success: true, data: parsed.data as z.output<Schema> };
  }
  return {
    success: false,
    error: `Invalid arguments for ${name}: ${z.prettifyError(parsed.error)}. ${expected}`,
  };
}

/**
 * Move a value given under a name the tool does not know to its main
 * parameter, when the arguments do not fit as they are: small models rename
 * it (`symbol` for `element`). The main parameter is the schema's only one,
 * else its one required parameter; nothing moves when there is no such
 * parameter, when it is already given, or when more than one name is unknown.
 * @param schema - The tool's schema.
 * @param parameters - The arguments, without nulls.
 * @returns The arguments, renamed when that is safe.
 */
export function normalizeToolArguments(
  schema: ToolSchema,
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  if (schema.safeParse(parameters).success) return parameters;
  const unknown = Object.keys(parameters).filter(
    (key) => !Object.hasOwn(schema.shape, key),
  );
  const [renamed] = unknown;
  const target = mainParameter(schema);
  if (
    unknown.length !== 1 ||
    renamed === undefined ||
    target === undefined ||
    Object.hasOwn(parameters, target)
  ) {
    return parameters;
  }
  const { [renamed]: value, ...rest } = parameters;
  return { ...rest, [target]: value };
}

/**
 * The parameter a renamed value is meant for.
 * @param schema - The tool's schema.
 * @returns Its only parameter, else its one required parameter, else
 *   undefined.
 */
function mainParameter(schema: ToolSchema): string | undefined {
  const keys = Object.keys(schema.shape);
  if (keys.length === 1) return keys[0];
  const required = keys.filter((key) => {
    const field = schema.shape[key];
    return field !== undefined && !z.safeParse(field, undefined).success;
  });
  return required.length === 1 ? required[0] : undefined;
}
