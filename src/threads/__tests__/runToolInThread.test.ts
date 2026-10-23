import { expect, test } from 'vitest';

import { ToolRefusalError, runToolInThread } from '../index.ts';

import { caught } from './caught.ts';
import type { TestJob } from './fixtures/jobs.ts';

function fixture(name: string): URL {
  return new URL(`fixtures/${name}.ts`, import.meta.url);
}

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  const error = await caught(promise);
  return error instanceof ToolRefusalError ? error.refusal : error;
}

test('a thread answers what its module posts', async () => {
  const answer = await runToolInThread(fixture('echo'), { compound: 'NaOH' });

  expect(answer).toStrictEqual({ echoed: { compound: 'NaOH' } });
});

test('a thread that runs past its time is terminated, and the call refused as a timeout', async () => {
  const started = performance.now();
  const refusal = await refusalOf(
    runToolInThread<TestJob, never>(fixture('jobs'), 'spin', {
      timeoutMs: 300,
    }),
  );

  expect(refusal).toStrictEqual({
    status: 422,
    code: 'timeout',
    error: 'The call took longer than 0.3 s and was stopped.',
  });
  expect(performance.now() - started).toBeLessThan(5000);
});

test('the timeout sentence is the server’s own, worded from the job', async () => {
  const refusal = await refusalOf(
    runToolInThread<TestJob, never>(fixture('jobs'), 'spin', {
      timeoutMs: 200,
      timeoutMessage: (seconds, job) =>
        `The ${job} job took longer than ${seconds} s: ask for less.`,
    }),
  );

  expect(refusal).toStrictEqual({
    status: 422,
    code: 'timeout',
    error: 'The spin job took longer than 0.2 s: ask for less.',
  });
});

test('a call beyond the running threads is asked to come back', async () => {
  const running = [
    refusalOf(runToolInThread(fixture('silent'), null, { timeoutMs: 1000 })),
    refusalOf(runToolInThread(fixture('silent'), null, { timeoutMs: 1000 })),
  ];
  const refused = await refusalOf(runToolInThread(fixture('echo'), null));
  const ended = await Promise.all(running);
  const after = await runToolInThread(fixture('echo'), 'again');

  expect(refused).toStrictEqual({
    status: 503,
    code: 'busy',
    error:
      'The server is already answering 2 calls: try again in a few seconds.',
    retryAfter: 5,
  });
  expect(
    ended.map((refusal) => (refusal as { code: string }).code),
  ).toStrictEqual(['timeout', 'timeout']);
  expect(after).toStrictEqual({ echoed: 'again' });
});

test('the busy sentence, the thread count and Retry-After are the server’s own', async () => {
  const options = {
    maxThreads: 1,
    timeoutMs: 500,
    busyMessage: (count: number) =>
      `The server is already solving ${count} equilibrium: try again soon.`,
    retryAfter: 10,
  };
  const running = refusalOf(runToolInThread(fixture('silent'), null, options));
  const refused = await refusalOf(
    runToolInThread(fixture('echo'), null, options),
  );
  await running;

  expect(refused).toStrictEqual({
    status: 503,
    code: 'busy',
    error: 'The server is already solving 1 equilibrium: try again soon.',
    retryAfter: 10,
  });
});

test('a refusal thrown in the thread is the caller’s refusal', async () => {
  const error = await caught(runToolInThread(fixture('jobs'), 'refuse'));

  expect(error).toBeInstanceOf(ToolRefusalError);
  expect((error as ToolRefusalError).refusal).toStrictEqual({
    status: 400,
    code: 'invalid-arguments',
    error: 'Give a molecular formula, e.g. C6H6.',
  });
});

test('any other error of the job rejects with its message', async () => {
  const error = await caught(runToolInThread(fixture('jobs'), 'break'));

  expect(error).not.toBeInstanceOf(ToolRefusalError);
  expect((error as Error).message).toBe('the job broke');
});

test('a module that throws rejects with its error', async () => {
  await expect(runToolInThread(fixture('failing'), null)).rejects.toThrow(
    'the job broke',
  );
});

test('an answer that cannot be posted rejects, saying why', async () => {
  await expect(runToolInThread(fixture('jobs'), 'function')).rejects.toThrow(
    'The answer could not be sent from the thread: () => 1 could not be cloned.',
  );
});

test('a job that cannot be posted rejects, saying why', async () => {
  const error = await caught(runToolInThread(fixture('echo'), () => 1));

  expect([
    (error as Error).message,
    ((error as Error).cause as Error).name,
  ]).toStrictEqual([
    'The job could not be posted to the thread.',
    'DataCloneError',
  ]);
});

test('a thread is stopped at its heap limit', async () => {
  const error = await caught(
    runToolInThread(fixture('jobs'), 'allocate', { heapMb: 16 }),
  );

  expect((error as { code: string }).code).toBe('ERR_WORKER_OUT_OF_MEMORY');
});
