import type { ZodObject, ZodRawShape, core } from 'zod';
import { z } from 'zod';

/**
 * The schema of a tool that forwards its calls to another server: the
 * catalog and MCP clients are offered that server's JSON Schema as it is,
 * and the arguments pass through unchecked, so that server's own refusal,
 * worded for the model, is what the model reads.
 * @param inputSchema - The other server's JSON Schema of the arguments.
 * @returns A loose zod object carrying that JSON Schema.
 */
export function proxySchema(
  inputSchema: Record<string, unknown>,
): ZodObject<ZodRawShape, core.$loose> {
  return z.looseObject({}).meta(inputSchema);
}
