import type { z } from 'zod';

import { ErrorReplySchema } from '../contract/index.ts';

import type { ToolClientFailure, ToolClientResult } from './types.ts';

/**
 * Read a response: an answer the schema accepts, or the server's refusal.
 * @param response - The response.
 * @param schema - What a 2xx body must be.
 * @returns The answer, or why there is none.
 */
export async function readResponse<Schema extends z.ZodType>(
  response: Response,
  schema: Schema,
): Promise<ToolClientResult<z.output<Schema>>> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return fail(
      'invalid-reply',
      response.status,
      'The tool server answered no JSON.',
    );
  }
  if (response.ok) {
    const parsed = schema.safeParse(body);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : fail(
          'invalid-reply',
          response.status,
          'The tool server answered outside the contract.',
        );
  }
  const refusal = ErrorReplySchema.safeParse(body);
  const retryAfter = Number(response.headers.get('retry-after'));
  return {
    ok: false,
    failure: {
      kind: refusal.success ? 'refused' : 'invalid-reply',
      status: response.status,
      code: refusal.success ? refusal.data.code : null,
      message: refusal.success
        ? refusal.data.error
        : `The tool server answered ${response.status}.`,
      retryAfter:
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
      reply: refusal.success ? refusal.data : null,
    },
  };
}

/**
 * A failure the server did not answer as a refusal.
 * @param kind - What went wrong.
 * @param status - The HTTP status, or null without an answer.
 * @param message - The sentence.
 * @returns The failure.
 */
export function fail(
  kind: ToolClientFailure['kind'],
  status: number | null,
  message: string,
): { ok: false; failure: ToolClientFailure } {
  return {
    ok: false,
    failure: {
      kind,
      status,
      code: null,
      message,
      retryAfter: null,
      reply: null,
    },
  };
}
