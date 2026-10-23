import { ToolRefusalError } from './types.ts';

/**
 * The refusal codes every server of the family answers with, the status of
 * each and when it is used. A server may add codes of its own; these are the
 * ones a client can branch on everywhere.
 */
export const REFUSAL_CODES = [
  {
    code: 'invalid-arguments',
    status: 400,
    meaning:
      'The arguments cannot be answered as they are: the sentence says what to change.',
  },
  {
    code: 'not-found',
    status: 404,
    meaning:
      'What the call names does not exist: a tool, a record, an address.',
  },
  {
    code: 'timeout',
    status: 422,
    meaning:
      'The arguments are right, but the answer took longer than a call is given and was stopped: ask for less.',
  },
  {
    code: 'internal',
    status: 500,
    meaning:
      'The tool failed. The routes answer it for any error that is not a refusal, and never send the error itself.',
  },
  {
    code: 'busy',
    status: 503,
    meaning:
      'The server is already answering as many calls as it can: try again after Retry-After seconds.',
  },
] as const;

/**
 * A code of {@link REFUSAL_CODES}.
 */
export type RefusalCode = (typeof REFUSAL_CODES)[number]['code'];

/**
 * Refuse a call whose arguments cannot be answered as they are.
 * @param message - One sentence saying what to change.
 * @throws {ToolRefusalError} Always: 400 `invalid-arguments`.
 */
export function refuseInvalid(message: string): never {
  throw new ToolRefusalError({
    status: 400,
    code: 'invalid-arguments',
    error: message,
  });
}

/**
 * Refuse a call naming something that does not exist.
 * @param message - One sentence saying what was not found, and what to ask.
 * @throws {ToolRefusalError} Always: 404 `not-found`.
 */
export function refuseNotFound(message: string): never {
  throw new ToolRefusalError({
    status: 404,
    code: 'not-found',
    error: message,
  });
}

/**
 * Refuse a call the server has no room for now.
 * @param message - One sentence saying the server is busy.
 * @param retryAfter - Seconds before trying again, sent as Retry-After.
 * @throws {ToolRefusalError} Always: 503 `busy`, with Retry-After.
 */
export function refuseBusy(message: string, retryAfter = 5): never {
  throw busyRefusal(message, retryAfter);
}

/**
 * Refuse a call whose answer took longer than a call is given.
 * @param message - One sentence saying what ran out of time, and what to ask
 * instead.
 * @throws {ToolRefusalError} Always: 422 `timeout`.
 */
export function refuseTimeout(message: string): never {
  throw timeoutRefusal(message);
}

/**
 * The refusal {@link refuseBusy} throws, for a caller that rejects with it.
 * @param message - One sentence saying the server is busy.
 * @param retryAfter - Seconds before trying again.
 * @returns The refusal.
 */
export function busyRefusal(
  message: string,
  retryAfter: number,
): ToolRefusalError {
  return new ToolRefusalError({
    status: 503,
    code: 'busy',
    error: message,
    retryAfter,
  });
}

/**
 * The refusal {@link refuseTimeout} throws, for a caller that rejects with it.
 * @param message - One sentence saying what ran out of time.
 * @returns The refusal.
 */
export function timeoutRefusal(message: string): ToolRefusalError {
  return new ToolRefusalError({ status: 422, code: 'timeout', error: message });
}
