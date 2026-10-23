/**
 * Speaks the family's worker protocol, `{ id, ok, response }` or
 * `{ id, ok: false, message }`, as a thread shared with the page does.
 */

import { parentPort } from 'node:worker_threads';

parentPort?.on('message', (message: { id: number; request: number }) => {
  const { id, request } = message;
  parentPort?.postMessage(
    request < 0
      ? { id, ok: false, message: `${request} is negative` }
      : { id, ok: true, response: { doubled: request * 2 } },
  );
});
