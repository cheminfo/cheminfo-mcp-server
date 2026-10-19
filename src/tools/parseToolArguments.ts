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
 * @param tool.schema - Its strict schema.
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
  if (parsed.success) return { success: true, data: parsed.data };
  return {
    success: false,
    error: `Invalid arguments for ${name}: ${z.prettifyError(parsed.error)}. ${expected}`,
  };
}

/**
 * Move a single value given under another name to a schema's only
 * parameter, when the arguments do not fit as they are.
 * @param schema - The tool's schema.
 * @param parameters - The arguments, without nulls.
 * @returns The arguments, renamed when that is safe.
 */
export function normalizeToolArguments(
  schema: ToolSchema,
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  if (schema.safeParse(parameters).success) return parameters;
  const keys = Object.keys(schema.shape);
  const values = Object.values(parameters);
  const [key] = keys;
  if (key !== undefined && keys.length === 1 && values.length === 1) {
    return { [key]: values[0] };
  }
  return parameters;
}
