import type { MessagePort } from 'node:worker_threads';
import { parentPort } from 'node:worker_threads';

import { ToolRefusalError } from '../tools/types.ts';

import type { ToolThreadReply, ToolThreadRequest } from './threadMessages.ts';

/**
 * Answer the calls posted to this worker thread, one after the other: the
 * entry module of `runToolInThread()` and of `createToolThreadPool()`. A
 * ToolRefusalError thrown by `run` is posted as the refusal the caller reads;
 * any other error as its message, which the caller rejects with.
 * @param run - Answers one job, typed as the thread's own; the answer must
 * survive `postMessage`.
 * @throws {Error} When called outside a worker thread.
 */
export function serveToolThread(run: (job: never) => unknown): void {
  const port = parentPort;
  if (port === null) {
    throw new Error('serveToolThread() answers calls in a worker thread only.');
  }
  port.on('message', (message: ToolThreadRequest<never>) => {
    void answer(port, message, run);
  });
}

async function answer(
  port: MessagePort,
  { id, request }: ToolThreadRequest<never>,
  run: (job: never) => unknown,
): Promise<void> {
  let reply: ToolThreadReply<unknown>;
  try {
    reply = { id, ok: true, answer: await run(request) };
  } catch (error) {
    reply =
      error instanceof ToolRefusalError
        ? { id, ok: false, refusal: error.refusal }
        : { id, ok: false, failure: messageOf(error) };
  }
  try {
    port.postMessage(reply);
  } catch (error) {
    port.postMessage({
      id,
      ok: false,
      failure: `The answer could not be sent from the thread: ${messageOf(error)}`,
    } satisfies ToolThreadReply<unknown>);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
