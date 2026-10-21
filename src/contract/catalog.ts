import { z } from 'zod';

/**
 * MCP's hints on what a tool does, for the client deciding to call it.
 */
export const ToolAnnotationsSchema = z.object({
  readOnlyHint: z.boolean().optional(),
  destructiveHint: z.boolean().optional(),
  idempotentHint: z.boolean().optional(),
  openWorldHint: z.boolean().optional(),
});

/**
 * MCP's hints on what a tool does.
 */
export type ToolAnnotations = z.infer<typeof ToolAnnotationsSchema>;

/**
 * A tool that only reads, gives the same answer twice and stays on this
 * server: the default of every tool.
 */
export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const satisfies ToolAnnotations;

/**
 * One tool of a catalog, as an LLM is offered it.
 */
export const CatalogToolSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  description: z.string(),
  /**
   * JSON Schema 2020-12 of the arguments: a strict object.
   */
  inputSchema: z.record(z.string(), z.unknown()),
  annotations: ToolAnnotationsSchema.optional(),
  /**
   * What MCP's tools/list carries beside: `ui` (the resource drawing the
   * answer, and who may call the tool), and a server's own fields.
   */
  _meta: z.record(z.string(), z.unknown()).optional(),
});

/**
 * `GET tools`: the same for every caller.
 */
export const ToolCatalogSchema = z.object({
  /**
   * 12 hex of a SHA-256 over the tools and the instructions.
   */
  version: z.string(),
  tools: z.array(CatalogToolSchema),
  /**
   * What the model is told about the tools as a whole.
   */
  instructions: z.string(),
});

/**
 * One tool of a catalog.
 */
export type CatalogTool = z.infer<typeof CatalogToolSchema>;
/**
 * `GET tools`.
 */
export type ToolCatalog = z.infer<typeof ToolCatalogSchema>;
