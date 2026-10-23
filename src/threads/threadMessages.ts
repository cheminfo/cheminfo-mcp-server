import type { ToolRefusal } from '../tools/types.ts';
import { ToolRefusalError } from '../tools/types.ts';

/**
 * What a thread is posted for one call: the family's worker request, a
 * serial number the reply echoes and the job.
 */
export interface ToolThreadRequest<Job> {
  /**
   * Serial number of the call, echoed by the reply.
   */
  id: number;
  /**
   * The job: the tool and its arguments, as the thread's `run` takes them.
   */
  request: Job;
}

/**
 * What a thread posts back for one call: the answer, the refusal the caller
 * reads, or the message of the error that stopped it.
 */
export type ToolThreadReply<Answer> =
  | { id: number; ok: true; answer: Answer }
  | { id: number; ok: false; refusal: ToolRefusal }
  | { id: number; ok: false; failure: string };

/**
 * The options both ways of running a call share.
 */
export interface ToolThreadMessages<Job> {
  /**
   * The sentence of the 503 `busy` refusal, given the calls already running
   * (and, in a pool, waiting).
   * @default `The server is already answering ${count} calls: try again in a few seconds.`
   */
  busyMessage?: (count: number) => string;
  /**
   * The sentence of the 422 `timeout` refusal.
   * @default `The call took longer than ${seconds} s and was stopped.`
   */
  timeoutMessage?: (seconds: number, job: Job) => string;
  /**
   * Seconds a busy server asks the caller to wait, sent as Retry-After.
   * @default 5
   */
  retryAfter?: number;
}

/**
 * The sentence of a busy refusal, unless the server words its own.
 * @param count - The calls already running.
 * @returns The sentence.
 */
export function defaultBusyMessage(count: number): string {
  return `The server is already answering ${count} calls: try again in a few seconds.`;
}

/**
 * The sentence of a timeout refusal, unless the server words its own.
 * @param seconds - The time the call was given.
 * @returns The sentence.
 */
export function defaultTimeoutMessage(seconds: number): string {
  return `The call took longer than ${seconds} s and was stopped.`;
}

/**
 * What a reply settles a call with: its answer, or the error to reject with.
 * @param reply - What the thread posted.
 * @returns The answer, or the error.
 */
export function outcomeOf<Answer>(
  reply: ToolThreadReply<Answer>,
): { ok: true; answer: Answer } | { ok: false; error: Error } {
  if (reply.ok) return { ok: true, answer: reply.answer };
  return {
    ok: false,
    error:
      'refusal' in reply
        ? new ToolRefusalError(reply.refusal)
        : new Error(reply.failure),
  };
}
