import type { ToolRunReply } from '../contract/index.ts';
import {
  MAX_FILES,
  MAX_MOLECULES,
  MAX_REACTIONS,
  MAX_SPECTRA,
} from '../contract/index.ts';

import { parseToolArguments } from './parseToolArguments.ts';
import type {
  ToolAnswer,
  ToolDefinition,
  ToolRefusal,
  ToolSchema,
} from './types.ts';
import { ToolRefusalError } from './types.ts';

/**
 * What a call gave: the reply, or why there is none.
 */
export type ToolRun =
  { ok: true; reply: ToolRunReply } | { ok: false; refusal: ToolRefusal };

/**
 * Options of {@link runTool}.
 */
export interface RunToolOptions {
  /**
   * Told when a tool throws: the caller only learns that it failed.
   * @default undefined
   */
  onError?: (error: unknown, name: string) => void;
  /**
   * The sentence of a 404 for a tool that does not exist.
   * @default (name) => `Unknown tool: ${name}`
   */
  unknownToolMessage?: (name: string) => string;
  /**
   * Told when an answer's `_meta` is longer than `metaWarnSize` characters
   * of JSON: a host may refuse it, and it travels on every call.
   * @default undefined
   */
  onLargeMeta?: (name: string, size: number) => void;
  /**
   * The JSON length of an answer's `_meta` above which `onLargeMeta` is
   * told.
   * @default 60000
   */
  metaWarnSize?: number;
  /**
   * Told when the result the model reads is longer than `resultWarnSize`
   * characters of JSON: it costs the model that much context.
   * @default undefined
   */
  onLargeResult?: (name: string, size: number) => void;
  /**
   * The JSON length of a result above which `onLargeResult` is told.
   * @default 100000
   */
  resultWarnSize?: number;
}

/**
 * The options executeTool() reads.
 */
export type ExecuteToolOptions = Pick<
  RunToolOptions,
  | 'onError'
  | 'onLargeMeta'
  | 'metaWarnSize'
  | 'onLargeResult'
  | 'resultWarnSize'
>;

/**
 * What the caller reads when a tool throws.
 */
export const TOOL_FAILED = 'The tool failed. Try again later.';

/**
 * Run one call: find the tool (404 `not-found`), check its arguments (400
 * `invalid-arguments`), and answer, the side channels trimmed to their
 * limits and left out when empty. A tool that throws a ToolRefusalError
 * refuses with it; any other error is a 500 `internal`.
 * @param tools - The server's tools.
 * @param name - The tool asked for.
 * @param parameters - Its arguments, as received.
 * @param context - What the server resolved for this request.
 * @param options - Who is told about a failure.
 * @returns The reply, or the refusal.
 */
export async function runTool<Context>(
  tools: ReadonlyArray<ToolDefinition<ToolSchema, Context>>,
  name: string,
  parameters: unknown,
  context: Context,
  options: RunToolOptions = {},
): Promise<ToolRun> {
  const tool = findTool(tools, name);
  if (tool === undefined) {
    return refuse(404, 'not-found', unknownToolMessage(name, options));
  }
  const parsed = parseToolArguments(tool, parameters);
  if (!parsed.success) {
    return refuse(400, 'invalid-arguments', parsed.error);
  }
  return executeTool(tool, parsed.data, context, options);
}

/**
 * Execute a tool whose arguments are already validated, as runTool() does
 * after checking them: for a server that resolves the context in between.
 * @param tool - The tool.
 * @param parameters - Its validated arguments.
 * @param context - What the server resolved for this request.
 * @param options - Who is told about a failure, a large `_meta` or a large
 *   result.
 * @returns The reply, or the refusal.
 */
export async function executeTool<Context>(
  tool: ToolDefinition<ToolSchema, Context>,
  parameters: unknown,
  context: Context,
  options: ExecuteToolOptions = {},
): Promise<ToolRun> {
  let answer: ToolAnswer;
  try {
    answer = await tool.execute(parameters as never, context);
  } catch (error) {
    if (error instanceof ToolRefusalError) {
      return { ok: false, refusal: error.refusal };
    }
    options.onError?.(error, tool.name);
    return refuse(500, 'internal', TOOL_FAILED);
  }
  const reply = replyOf(answer);
  if (reply._meta !== undefined && options.onLargeMeta !== undefined) {
    const size = JSON.stringify(reply._meta).length;
    if (size > (options.metaWarnSize ?? 60_000)) {
      options.onLargeMeta(tool.name, size);
    }
  }
  if (options.onLargeResult !== undefined) {
    const size = JSON.stringify(reply.result).length;
    if (size > (options.resultWarnSize ?? 100_000)) {
      options.onLargeResult(tool.name, size);
    }
  }
  return { ok: true, reply };
}

/**
 * The reply of an answer: the molecules always, the other side channels
 * only when they hold something, `structuredContent` and `_meta` when set.
 * @param answer - What the tool answered.
 * @returns The reply.
 */
function replyOf(answer: ToolAnswer): ToolRunReply {
  const reply: ToolRunReply = {
    result: answer.result,
    molecules: (answer.molecules ?? []).slice(0, MAX_MOLECULES),
  };
  const reactions = (answer.reactions ?? []).slice(0, MAX_REACTIONS);
  if (reactions.length > 0) reply.reactions = reactions;
  const spectra = (answer.spectra ?? []).slice(0, MAX_SPECTRA);
  if (spectra.length > 0) reply.spectra = spectra;
  const files = (answer.files ?? []).slice(0, MAX_FILES);
  if (files.length > 0) reply.files = files;
  if (answer.structuredContent !== undefined) {
    reply.structuredContent = answer.structuredContent;
  }
  if (answer.meta !== undefined) reply._meta = answer.meta;
  return reply;
}

/**
 * The tool of that name.
 * @param tools - The server's tools.
 * @param name - The name asked for.
 * @returns The tool, or undefined when none has that name.
 */
export function findTool<Context>(
  tools: ReadonlyArray<ToolDefinition<ToolSchema, Context>>,
  name: string,
): ToolDefinition<ToolSchema, Context> | undefined {
  return tools.find((candidate) => candidate.name === name);
}

/**
 * The sentence of a 404 for a tool that does not exist.
 * @param name - The name asked for.
 * @param options - The server's wording, if any.
 * @returns The sentence.
 */
export function unknownToolMessage(
  name: string,
  options: Pick<RunToolOptions, 'unknownToolMessage'>,
): string {
  return options.unknownToolMessage?.(name) ?? `Unknown tool: ${name}`;
}

function refuse(status: number, code: string, error: string): ToolRun {
  return { ok: false, refusal: { status, code, error } };
}
