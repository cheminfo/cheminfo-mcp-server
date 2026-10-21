import { z } from 'zod';

import {
  DisplayFileSchema,
  DisplayMoleculeSchema,
  DisplayReactionSchema,
  DisplaySpectrumSchema,
  MAX_FILES,
  MAX_MOLECULES,
  MAX_REACTIONS,
  MAX_SPECTRA,
} from './displays.ts';

/**
 * `POST tools/{name}`: what the model reads, and what the page draws beside
 * it. Only the page reads the side channels, so a malformed or oversized one
 * is dropped, never the answer the model reads.
 */
export const ToolRunReplySchema = z.object({
  result: z.record(z.string(), z.unknown()),
  molecules: z.array(DisplayMoleculeSchema).max(MAX_MOLECULES).catch([]),
  reactions: z
    .array(DisplayReactionSchema)
    .max(MAX_REACTIONS)
    .optional()
    .catch(undefined),
  spectra: z
    .array(DisplaySpectrumSchema)
    .max(MAX_SPECTRA)
    .optional()
    .catch(undefined),
  files: z.array(DisplayFileSchema).max(MAX_FILES).optional().catch(undefined),
  /**
   * MCP's `structuredContent`: the result as data, for a view.
   */
  structuredContent: z
    .record(z.string(), z.unknown())
    .optional()
    .catch(undefined),
  /**
   * MCP's `_meta`: what a view reads and the model never does.
   */
  _meta: z.record(z.string(), z.unknown()).optional().catch(undefined),
});

/**
 * The body of every refusal: a sentence for the person or the model, and a
 * stable code to branch on. A server may add fields of its own.
 */
export const ErrorReplySchema = z.looseObject({
  error: z.string(),
  code: z.string(),
});

/**
 * `POST tools/{name}`.
 */
export type ToolRunReply = z.infer<typeof ToolRunReplySchema>;
/**
 * The body of a refusal.
 */
export type ErrorReply = z.infer<typeof ErrorReplySchema>;
