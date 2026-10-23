import type { Worker } from 'node:worker_threads';

import { busyRefusal } from '../tools/refusals.ts';

import type { PendingCall, PoolState } from './poolCalls.ts';
import { dispatch } from './poolCalls.ts';
import type { ToolThreadMessages, ToolThreadReply } from './threadMessages.ts';
import { defaultBusyMessage } from './threadMessages.ts';

/**
 * Options of {@link createToolThreadPool}.
 */
export interface ToolThreadPoolOptions<
  Job,
  Answer,
> extends ToolThreadMessages<Job> {
  /**
   * The thread's module: it calls `serveToolThread()`, or answers the
   * pool's `{ id, request }` messages in a protocol `decode` reads.
   */
  threadUrl: URL;
  /**
   * Calls running at once, a thread each.
   * @default 2
   */
  threads?: number;
  /**
   * Calls that may wait for a thread; one more is refused.
   * @default 4
   */
  maxWaiting?: number;
  /**
   * The longest a call may take on its thread, the start of the thread
   * included, in milliseconds; the thread is then terminated.
   * @default 20000
   */
  deadlineMs?: number;
  /**
   * The heap each thread may grow to, in megabytes.
   * @default 256
   */
  heapMb?: number;
  /**
   * The Node.js flags of the threads. None of this process reaches them by
   * default: `--watch` is refused there, and type stripping needs none.
   * @default []
   */
  execArgv?: string[];
  /**
   * Reads a message of a thread that speaks its own protocol, as the reply
   * of `serveToolThread()` it stands for.
   * @default the message itself
   */
  decode?: (message: unknown) => ToolThreadReply<Answer>;
}

/**
 * Runs calls on threads that stay loaded between them.
 */
export interface ToolThreadPool<Job, Answer> {
  /**
   * Run one call, as soon as a thread is free.
   * @param job - What the thread is posted.
   * @returns The answer.
   * @throws {Error} A ToolRefusalError: the call's own refusal, 503 `busy`
   * (with Retry-After) when `maxWaiting` calls already wait, or 422
   * `timeout`; any other error of the thread, with its message; or an error
   * saying the thread could not start, stopped, or the pool is closed.
   */
  run: (job: Job) => Promise<Answer>;
  /**
   * Stop every thread, and reject what runs or waits.
   */
  close: () => Promise<void>;
}

/**
 * Start a pool of threads for calls that load something heavy, such as
 * OpenChemLib, once. No thread starts before the first call; a thread left
 * idle stays for the next one, without holding the process open. A call past
 * the deadline is stopped by throwing its thread away, and a bounded queue
 * refuses a call it could not start in time instead of letting work pile up.
 * @param options - The thread's module, threads, queue, deadline and heap.
 * @returns The pool.
 */
export function createToolThreadPool<Job, Answer>(
  options: ToolThreadPoolOptions<Job, Answer>,
): ToolThreadPool<Job, Answer> {
  const {
    threads = 2,
    maxWaiting = 4,
    busyMessage = defaultBusyMessage,
    retryAfter = 5,
  } = options;
  const idle: Worker[] = [];
  const busy = new Set<Worker>();
  const waiting: Array<PendingCall<Job, Answer>> = [];
  const pool: PoolState<Job, Answer> = {
    options,
    idle,
    busy,
    waiting,
    counter: 0,
    closed: false,
  };

  return {
    run(job) {
      if (pool.closed) return Promise.reject(new Error('The pool is closed.'));
      if (busy.size >= threads && waiting.length >= maxWaiting) {
        return Promise.reject(
          busyRefusal(busyMessage(busy.size + waiting.length), retryAfter),
        );
      }
      return new Promise<Answer>((resolve, reject) => {
        waiting.push({ job, resolve, reject });
        dispatch(pool);
      });
    },
    async close() {
      pool.closed = true;
      for (const call of waiting.splice(0)) {
        call.reject(new Error('The pool is closed.'));
      }
      const workers = [...idle.splice(0), ...busy];
      await Promise.all(workers.map((worker) => worker.terminate()));
    },
  };
}
