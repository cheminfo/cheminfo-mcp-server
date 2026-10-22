import type { ZodObject, ZodRawShape, core, z } from 'zod';

import type {
  DisplayCurve,
  DisplayFile,
  DisplayMolecule,
  DisplayReaction,
  DisplaySpectrum,
  ToolAnnotations,
  ToolUi,
} from '../contract/index.ts';

/**
 * A tool's arguments: a strict zod object, so an unknown one is refused; or,
 * for a tool that forwards its call to another server, a loose one made by
 * `proxySchema()`, which another server checks.
 */
export type ToolSchema =
  ZodObject<ZodRawShape, core.$strict> | ZodObject<ZodRawShape, core.$loose>;

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
   * Curves to draw, such as a titration curve; at most 8 are kept.
   * @default []
   */
  curves?: DisplayCurve[];
  /**
   * Files to offer; at most 8 are kept.
   * @default []
   */
  files?: DisplayFile[];
  /**
   * MCP's `structuredContent`: the result as data, for a view.
   * @default undefined
   */
  structuredContent?: Record<string, unknown>;
  /**
   * MCP's `_meta` of the result: what a view reads and the model never does.
   * @default undefined
   */
  meta?: Record<string, unknown>;
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
   * The app resource that draws the answer (`ui://…`), and who may call the
   * tool: `['app']` keeps it from the model, a view's own call.
   * @default undefined - no view, and both may call it
   */
  ui?: ToolUi;
  /**
   * More of the tool's `_meta` on tools/list and in the catalog; `ui` wins
   * over a `ui` here. A forwarded tool passes the other server's on.
   * @default undefined
   */
  meta?: Record<string, unknown>;
  /**
   * Answer one call. A ToolRefusalError is the caller's answer; any other
   * error answers 500 to the JSON route and an error result to MCP, and
   * never reaches the caller itself.
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
  /**
   * More fields of the JSON refusal, after `error` and `code`: a server's
   * own (`mirror`, `promptSection`). MCP reads only `error`.
   * @default undefined
   */
  extra?: Record<string, unknown>;
}

/**
 * Thrown by a tool to refuse a call with its own status, code and sentence,
 * e.g. a 503 while the data cannot be checked. Unlike any other error, the
 * caller reads it.
 */
export class ToolRefusalError extends Error {
  public readonly refusal: ToolRefusal;

  /**
   * Refuse the call.
   * @param refusal - What the caller reads.
   */
  public constructor(refusal: ToolRefusal) {
    super(refusal.error);
    this.name = 'ToolRefusalError';
    this.refusal = refusal;
  }
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
