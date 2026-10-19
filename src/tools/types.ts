import type { ZodObject, ZodRawShape, core, z } from 'zod';

import type {
  DisplayFile,
  DisplayMolecule,
  DisplayReaction,
  DisplaySpectrum,
  ToolAnnotations,
} from '../contract/index.ts';

/**
 * A tool's arguments: a strict zod object, so an unknown one is refused.
 */
export type ToolSchema = ZodObject<ZodRawShape, core.$strict>;

/**
 * What a tool answers: what the model reads, and what is drawn beside it.
 */
export interface ToolAnswer {
  /**
   * What the model reads: a JSON object.
   */
  result: Record<string, unknown>;
  /**
   * Structures to draw; at most 12 are kept.
   * @default []
   */
  molecules?: DisplayMolecule[];
  /**
   * Reaction schemes to draw; at most 4 are kept.
   * @default []
   */
  reactions?: DisplayReaction[];
  /**
   * Spectra to draw; at most 8 are kept.
   * @default []
   */
  spectra?: DisplaySpectrum[];
  /**
   * Files to offer; at most 8 are kept.
   * @default []
   */
  files?: DisplayFile[];
}

/**
 * A tool: what an LLM is offered (name, title, description, strict schema,
 * annotations), and what runs it for one request's context.
 */
export interface ToolDefinition<
  Schema extends ToolSchema = ToolSchema,
  Context = unknown,
> {
  /**
   * Unique on the server, e.g. `mfFromMass`.
   */
  name: string;
  /**
   * For people: what the tool does, in a few words.
   */
  title: string;
  /**
   * For the model: when to use it, and what it returns.
   */
  description: string;
  schema: Schema;
  /**
   * MCP's hints on what the tool does.
   * @default READ_ONLY_ANNOTATIONS
   */
  annotations?: ToolAnnotations;
  /**
   * Answer one call. Throwing answers 500 to the JSON route and an error
   * result to MCP; the error itself never reaches the caller.
   * @param parameters - The arguments, validated by `schema`.
   * @param context - What the server resolved for this request.
   */
  execute(
    parameters: z.output<Schema>,
    context: Context,
  ): ToolAnswer | Promise<ToolAnswer>;
}

/**
 * Every tool of a server, or a function giving them for each request.
 */
export type ToolList<Context> =
  | ReadonlyArray<ToolDefinition<ToolSchema, Context>>
  | (() => ReadonlyArray<ToolDefinition<ToolSchema, Context>>);

/**
 * Why a call is not answered: an HTTP status, a stable code, a sentence.
 */
export interface ToolRefusal {
  status: number;
  /**
   * What clients branch on, e.g. `invalid-arguments`, `not-found`.
   */
  code: string;
  /**
   * For the person or the model; never a secret.
   */
  error: string;
  /**
   * Seconds before trying again, sent as Retry-After.
   * @default undefined
   */
  retryAfter?: number;
}

/**
 * Declare a tool, with its arguments' type read from its schema.
 * @param tool - The tool.
 * @returns The same tool.
 */
export function defineTool<Schema extends ToolSchema, Context = unknown>(
  tool: ToolDefinition<Schema, Context>,
): ToolDefinition<Schema, Context> {
  return tool;
}

/**
 * The tools of this request.
 * @param tools - The list, or the function giving it.
 * @returns The tools.
 */
export function toolsOf<Context>(
  tools: ToolList<Context>,
): ReadonlyArray<ToolDefinition<ToolSchema, Context>> {
  return typeof tools === 'function' ? tools() : tools;
}
