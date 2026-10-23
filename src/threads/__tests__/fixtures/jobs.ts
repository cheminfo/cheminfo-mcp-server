/**
 * Does what each job asks: names its thread, spins without end, refuses,
 * throws, answers what cannot be posted, or fills its heap.
 */

import { threadId } from 'node:worker_threads';

import { refuseInvalid, serveToolThread } from '../../index.ts';

/**
 * What a test asks the thread to do.
 */
export type TestJob =
  'allocate' | 'break' | 'function' | 'refuse' | 'spin' | 'thread';

serveToolThread((job: TestJob) => {
  switch (job) {
    case 'allocate':
      return allocate();
    case 'break':
      throw new Error('the job broke');
    case 'function':
      return { run: () => 1 };
    case 'refuse':
      return refuseInvalid('Give a molecular formula, e.g. C6H6.');
    case 'spin':
      return spin();
    case 'thread':
      return { threadId };
    // no default
  }
});

function spin(): never {
  for (;;) {
    // Nothing: only terminating the thread stops it.
  }
}

function allocate(): never {
  const kept: number[][] = [];
  for (;;) kept.push(new Array<number>(100_000).fill(kept.length));
}
