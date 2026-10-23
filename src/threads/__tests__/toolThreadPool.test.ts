import { expect, test } from 'vitest';

import type { ToolThreadPoolOptions, ToolThreadReply } from '../index.ts';
import { ToolRefusalError, createToolThreadPool } from '../index.ts';

import { caught } from './caught.ts';
import type { TestJob } from './fixtures/jobs.ts';

function poolOf<Job, Answer>(
  fixture: string,
  options: Omit<ToolThreadPoolOptions<Job, Answer>, 'threadUrl'> = {},
) {
  return createToolThreadPool<Job, Answer>({
    ...options,
    threadUrl: new URL(`fixtures/${fixture}.ts`, import.meta.url),
  });
}

async function outcome(promise: Promise<unknown>): Promise<string> {
  const error = await caught(promise);
  if (error === undefined) return 'answered';
  if (error instanceof ToolRefusalError) return error.refusal.code;
  return error instanceof Error ? `Error: ${error.message}` : 'unknown';
}

test('a call is answered by its thread, which stays warm for the next one', async () => {
  const pool = poolOf<TestJob, { threadId: number }>('jobs');
  const first = await pool.run('thread');
  const second = await pool.run('thread');
  await pool.close();

  expect(second).toStrictEqual(first);
});

test('calls wait for a thread, and one too many is refused at once', async () => {
  const pool = poolOf('echo', { threads: 1, maxWaiting: 1 });
  const answers = await Promise.all([
    pool.run('first'),
    pool.run('second'),
    caught(pool.run('third')),
  ]);
  await pool.close();

  expect(answers.slice(0, 2)).toStrictEqual([
    { echoed: 'first' },
    { echoed: 'second' },
  ]);
  expect((answers[2] as ToolRefusalError).refusal).toStrictEqual({
    status: 503,
    code: 'busy',
    error:
      'The server is already answering 2 calls: try again in a few seconds.',
    retryAfter: 5,
  });
});

test('a call past the deadline is stopped with its thread, and the next gets a new one', async () => {
  // The deadline includes the start of a thread, slow on a loaded machine.
  const pool = poolOf<TestJob, { threadId: number }>('jobs', {
    deadlineMs: 2000,
    timeoutMessage: (seconds, job) =>
      `The ${job} job was stopped after ${seconds} s.`,
  });
  const before = await pool.run('thread');
  const started = performance.now();
  const stopped = await caught(pool.run('spin'));
  const elapsed = performance.now() - started;
  const after = await pool.run('thread');
  await pool.close();

  expect((stopped as ToolRefusalError).refusal).toStrictEqual({
    status: 422,
    code: 'timeout',
    error: 'The spin job was stopped after 2 s.',
  });
  expect(elapsed).toBeLessThan(6000);
  expect(after.threadId).not.toBe(before.threadId);
});

test('a refusal is the caller’s, and an error its message; the thread stays', async () => {
  const pool = poolOf<TestJob, { threadId: number }>('jobs', { threads: 1 });
  const before = await pool.run('thread');
  const refused = await caught(pool.run('refuse'));
  const broken = await caught(pool.run('break'));
  const after = await pool.run('thread');
  await pool.close();

  expect((refused as ToolRefusalError).refusal).toStrictEqual({
    status: 400,
    code: 'invalid-arguments',
    error: 'Give a molecular formula, e.g. C6H6.',
  });
  expect(broken).not.toBeInstanceOf(ToolRefusalError);
  expect((broken as Error).message).toBe('the job broke');
  expect(after).toStrictEqual(before);
});

test('a thread that fails as it loads rejects the call, its error as the cause', async () => {
  const pool = poolOf('failing');
  const error = await caught(pool.run(null));
  await pool.close();

  expect((error as Error).message).toBe(
    'The thread stopped without answering.',
  );
  expect(((error as Error).cause as Error).message).toBe('the job broke');
});

test('a thread that cannot start rejects the call, and the pool goes on', async () => {
  const pool = createToolThreadPool({
    threadUrl: new URL('https://example.org/thread.js'),
  });
  const errors = await Promise.all([
    caught(pool.run(null)),
    caught(pool.run(null)),
  ]);
  await pool.close();

  expect(errors.map((error) => (error as Error).message)).toStrictEqual([
    'The thread could not start.',
    'The thread could not start.',
  ]);
  expect(((errors[0] as Error).cause as { code: string }).code).toBe(
    'ERR_INVALID_URL_SCHEME',
  );
});

test('a job that cannot be posted rejects, and its thread stays', async () => {
  const pool = poolOf('echo', { threads: 1 });
  const error = await caught(pool.run(() => 1));
  const after = await pool.run('after');
  await pool.close();

  expect([
    (error as Error).message,
    ((error as Error).cause as Error).name,
    after,
  ]).toStrictEqual([
    'The job could not be posted to the thread.',
    'DataCloneError',
    { echoed: 'after' },
  ]);
});

test('a thread is stopped at its heap limit', async () => {
  const pool = poolOf<TestJob, never>('jobs', { heapMb: 16 });
  const error = await caught(pool.run('allocate'));
  await pool.close();

  expect(((error as Error).cause as { code: string }).code).toBe(
    'ERR_WORKER_OUT_OF_MEMORY',
  );
});

test('closing rejects what runs and what waits, and a closed pool takes nothing more', async () => {
  const pool = poolOf('silent', { threads: 1, maxWaiting: 2 });
  const running = outcome(pool.run(null));
  const waiting = outcome(pool.run(null));
  await pool.close();
  const after = await outcome(pool.run(null));

  expect([await running, await waiting, after]).toStrictEqual([
    'Error: The thread stopped without answering.',
    'Error: The pool is closed.',
    'Error: The pool is closed.',
  ]);
});

test('a thread speaking its own protocol is read through decode', async () => {
  const pool = poolOf<number, { doubled: number }>('family', {
    decode: (message) => {
      const reply = message as
        | { id: number; ok: true; response: { doubled: number } }
        | { id: number; ok: false; message: string };
      return reply.ok
        ? { id: reply.id, ok: true, answer: reply.response }
        : {
            id: reply.id,
            ok: false,
            refusal: {
              status: 400,
              code: 'invalid-arguments',
              error: `The count cannot be read: ${reply.message}.`,
            },
          };
    },
  });
  const doubled = await pool.run(21);
  const refused = await caught(pool.run(-1));
  await pool.close();

  expect(doubled).toStrictEqual({ doubled: 42 });
  expect((refused as ToolRefusalError).refusal).toStrictEqual({
    status: 400,
    code: 'invalid-arguments',
    error: 'The count cannot be read: -1 is negative.',
  });
});

test('a decode that throws rejects the call', async () => {
  const pool = poolOf<number, never>('family', {
    decode: (): ToolThreadReply<never> => {
      throw new Error('not a reply');
    },
  });
  const error = await caught(pool.run(1));
  await pool.close();

  expect((error as Error).message).toBe('not a reply');
});
