import { Worker } from 'node:worker_threads';

import { timeoutRefusal } from '../tools/refusals.ts';

import type { ToolThreadReply, ToolThreadRequest } from './threadMessages.ts';
import { defaultTimeoutMessage, outcomeOf } from './threadMessages.ts';
import type { ToolThreadPoolOptions } from './toolThreadPool.ts';

/**
 * A call waiting for a thread, or running on one.
 */
export interface PendingCall<Job, Answer> {
  job: Job;
  resolve: (answer: Answer) => void;
  reject: (error: Error) => void;
}

/**
 * The threads and calls of one pool.
 */
export interface PoolState<Job, Answer> {
  options: ToolThreadPoolOptions<Job, Answer>;
  idle: Worker[];
  busy: Set<Worker>;
  waiting: Array<PendingCall<Job, Answer>>;
  counter: number;
  closed: boolean;
}

/**
 * Start the waiting calls a free thread can take.
 * @param pool - The pool.
 */
export function dispatch<Job, Answer>(pool: PoolState<Job, Answer>): void {
  const { threads = 2 } = pool.options;
  while (!pool.closed && pool.busy.size < threads) {
    const call = pool.waiting.shift();
    if (call === undefined) return;
    start(pool, call);
  }
}

function start<Job, Answer>(
  pool: PoolState<Job, Answer>,
  call: PendingCall<Job, Answer>,
): void {
  const {
    deadlineMs = 20_000,
    timeoutMessage = defaultTimeoutMessage,
    decode = (message: unknown) => message as ToolThreadReply<Answer>,
  } = pool.options;
  let worker: Worker;
  try {
    worker = pool.idle.pop() ?? newWorker(pool);
  } catch (error) {
    call.reject(new Error('The thread could not start.', { cause: error }));
    return;
  }
  worker.ref();
  pool.busy.add(worker);
  pool.counter += 1;
  const id = pool.counter;
  let isSettled = false;

  function finish(
    outcome: { ok: true; answer: Answer } | { ok: false; error: Error },
    isKept: boolean,
  ): void {
    if (isSettled) return;
    isSettled = true;
    clearTimeout(timer);
    worker.off('message', onMessage);
    worker.off('error', onFailure);
    worker.off('exit', onFailure);
    pool.busy.delete(worker);
    if (isKept && !pool.closed) {
      worker.unref();
      pool.idle.push(worker);
    } else {
      void worker.terminate();
    }
    if (outcome.ok) call.resolve(outcome.answer);
    else call.reject(outcome.error);
    dispatch(pool);
  }

  function onMessage(message: unknown): void {
    let reply: ToolThreadReply<Answer>;
    try {
      reply = decode(message);
    } catch (error) {
      finish({ ok: false, error: error as Error }, false);
      return;
    }
    if (reply.id !== id) return;
    finish(outcomeOf(reply), true);
  }

  function onFailure(cause: unknown): void {
    finish(
      {
        ok: false,
        error: new Error('The thread stopped without answering.', { cause }),
      },
      false,
    );
  }

  const timer = setTimeout(() => {
    finish(
      {
        ok: false,
        error: timeoutRefusal(timeoutMessage(deadlineMs / 1000, call.job)),
      },
      false,
    );
  }, deadlineMs);
  worker.on('message', onMessage);
  worker.on('error', onFailure);
  worker.on('exit', onFailure);
  const request: ToolThreadRequest<Job> = { id, request: call.job };
  try {
    worker.postMessage(request);
  } catch (error) {
    finish(
      {
        ok: false,
        error: new Error('The job could not be posted to the thread.', {
          cause: error,
        }),
      },
      true,
    );
  }
}

function newWorker<Job, Answer>(pool: PoolState<Job, Answer>): Worker {
  const { threadUrl, heapMb = 256, execArgv = [] } = pool.options;
  const worker = new Worker(threadUrl, {
    execArgv,
    resourceLimits: { maxOldGenerationSizeMb: heapMb },
  });
  // A thread that fails or ends while idle is never handed a call, and its
  // error is not left without a listener.
  const forget = () => {
    const index = pool.idle.indexOf(worker);
    if (index !== -1) pool.idle.splice(index, 1);
  };
  worker.on('error', forget);
  worker.once('exit', forget);
  return worker;
}
