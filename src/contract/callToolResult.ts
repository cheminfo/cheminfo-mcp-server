import type { ToolRunReply } from './toolRun.ts';

/**
 * A tool's answer as MCP's tools/call gives it: the text the model reads,
 * and what a view reads.
 */
export interface ToolCallResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  /**
   * The result as data, for a view.
   * @default undefined
   */
  structuredContent?: Record<string, unknown>;
  /**
   * What a view reads and the model never does.
   * @default undefined
   */
  _meta?: Record<string, unknown>;
  /**
   * The call was refused; `content` says why.
   * @default undefined
   */
  isError?: boolean;
}

/**
 * The answer of `POST tools/{name}` as MCP's tools/call gives it, so a host
 * feeds a view the same whichever way it called: the result as JSON text,
 * then each file's content (an MCP client has no side channel), with the
 * `structuredContent` and `_meta` it has.
 * @param reply - The JSON route's answer.
 * @returns The MCP result.
 */
export function toCallToolResult(reply: ToolRunReply): ToolCallResult {
  const content: ToolCallResult['content'] = [
    { type: 'text', text: JSON.stringify(reply.result, null, 2) },
  ];
  const { files = [] } = reply;
  for (const file of files) {
    content.push({ type: 'text', text: file.content });
  }
  const result: ToolCallResult = { content };
  if (reply.structuredContent !== undefined) {
    result.structuredContent = reply.structuredContent;
  }
  if (reply._meta !== undefined) result._meta = reply._meta;
  return result;
}

/**
 * A refusal as MCP's tools/call gives it.
 * @param message - What the model reads.
 * @returns The error result.
 */
export function toErrorCallToolResult(message: string): ToolCallResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}
