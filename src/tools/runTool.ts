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
}

/**
 * What the caller reads when a tool throws.
 */
export const TOOL_FAILED = 'The tool failed. Try again later.';

/**
 * Run one call: find the tool (404 `not-found`), check its arguments (400
 * `invalid-arguments`), and answer, the side channels trimmed to their
 * limits and left out when empty. A tool that throws is a 500 `internal`.
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
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    return refuse(404, 'not-found', `Unknown tool: ${name}`);
  }
  const parsed = parseToolArguments(tool, parameters);
  if (!parsed.success) {
    return refuse(400, 'invalid-arguments', parsed.error);
  }
  let answer: ToolAnswer;
  try {
    answer = await tool.execute(parsed.data, context);
  } catch (error) {
    options.onError?.(error, name);
    return refuse(500, 'internal', TOOL_FAILED);
  }
  return { ok: true, reply: replyOf(answer) };
}

/**
 * The reply of an answer: the molecules always, the other side channels
 * only when they hold something.
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
  return reply;
}

function refuse(status: number, code: string, error: string): ToolRun {
  return { ok: false, refusal: { status, code, error } };
}
