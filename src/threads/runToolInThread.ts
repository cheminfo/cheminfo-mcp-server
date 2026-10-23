import { Worker } from 'node:worker_threads';

import { refuseBusy, timeoutRefusal } from '../tools/refusals.ts';

import type {
  ToolThreadMessages,
  ToolThreadReply,
  ToolThreadRequest,
} from './threadMessages.ts';
import {
  defaultBusyMessage,
  defaultTimeoutMessage,
  outcomeOf,
} from './threadMessages.ts';

/**
 * Options of {@link runToolInThread}.
 */
export interface RunToolInThreadOptions<Job> extends ToolThreadMessages<Job> {
  /**
   * Calls running at once in this process, a thread each; one more is
   * refused, never queued.
   * @default 2
   */
  maxThreads?: number;
  /**
   * The longest a call may run, the start of its thread included, in
   * milliseconds; its thread is then terminated.
   * @default 10000
   */
  timeoutMs?: number;
  /**
   * The heap the thread may grow to, in megabytes.
   * @default 256
   */
  heapMb?: number;
  /**
   * The Node.js flags of the thread. None of this process reaches it by
   * default: `--watch` is refused there, and type stripping needs none.
   * @default []
   */
  execArgv?: string[];
}

/**
 * The calls running in a thread of their own, in this process.
 */
const threads = { running: 0 };

/**
 * Run one call in a worker thread of its own, so that no call can hold the
 * server: a thread that runs past its time is terminated, which stops a
 * loop, a regular expression or WebAssembly that cannot be asked to stop
 * from inside. The thread is ended once it answers, and only `maxThreads`
 * run at once: a call beyond them is asked to come back rather than queued.
 * @param entry - The thread's module, which calls `serveToolThread()`.
 * @param job - What the module's `run` is handed.
 * @param options - How many threads, how long and how much memory.
 * @returns The answer the thread posted.
 * @throws {Error} A ToolRefusalError: the call's own refusal, 503 `busy`
 * (with Retry-After) when `maxThreads` calls are running, or 422 `timeout`;
 * any other error of the thread, with its message.
 */
export async function runToolInThread<Job, Answer>(
  entry: URL,
  job: Job,
  options: RunToolInThreadOptions<Job> = {},
): Promise<Answer> {
  const {
    maxThreads = 2,
    busyMessage = defaultBusyMessage,
    retryAfter = 5,
  } = options;
  if (threads.running >= maxThreads) {
    refuseBusy(busyMessage(maxThreads), retryAfter);
  }
  threads.running++;
  try {
    return await answerOf<Job, Answer>(entry, job, options);
  } finally {
    threads.running--;
  }
}

function answerOf<Job, Answer>(
  entry: URL,
  job: Job,
  options: RunToolInThreadOptions<Job>,
): Promise<Answer> {
  const {
    timeoutMs = 10_000,
    heapMb = 256,
    execArgv = [],
    timeoutMessage = defaultTimeoutMessage,
  } = options;
  return new Promise<Answer>((resolve, reject) => {
    const worker = new Worker(entry, {
      execArgv,
      resourceLimits: { maxOldGenerationSizeMb: heapMb },
    });
    const timer = setTimeout(() => {
      reject(timeoutRefusal(timeoutMessage(timeoutMs / 1000, job)));
      void worker.terminate();
    }, timeoutMs);
    worker.on('message', (reply: ToolThreadReply<Answer>) => {
      if (reply.id !== 1) return;
      clearTimeout(timer);
      const outcome = outcomeOf(reply);
      if (outcome.ok) resolve(outcome.answer);
      else reject(outcome.error);
      void worker.terminate();
    });
    worker.once('error', (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once('exit', (code) => {
      clearTimeout(timer);
      // After an answer this settles nothing: a promise settles once.
      reject(
        new Error(`The thread stopped without answering (exit code ${code}).`),
      );
    });
    const request: ToolThreadRequest<Job> = { id: 1, request: job };
    try {
      worker.postMessage(request);
    } catch (error) {
      clearTimeout(timer);
      reject(
        new Error('The job could not be posted to the thread.', {
          cause: error,
        }),
      );
      void worker.terminate();
    }
  });
}
