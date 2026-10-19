import { afterAll, expect, test } from 'vitest';

import type { SampleServer } from '../../__tests__/sampleServer.ts';
import { startSampleServer } from '../../__tests__/sampleServer.ts';
import { SAMPLE_TOKEN } from '../../__tests__/sampleTools.ts';
import type { FetchLike } from '../index.ts';
import { createToolClient } from '../index.ts';

const server: SampleServer = await startSampleServer();

afterAll(async () => {
  await server.app.close();
});

test('the client reads the catalog once per minute, and calls a tool with its side channels', async () => {
  let now = 0;
  let catalogCalls = 0;
  const counting: FetchLike = (url, init) => {
    if (url.pathname.endsWith('/tools')) catalogCalls++;
    return fetch(url, init);
  };
  const client = createToolClient({
    baseUrl: server.baseUrl,
    fetch: counting,
    headers: { 'x-token': SAMPLE_TOKEN },
    now: () => now,
  });

  const first = await client.catalog();
  await client.catalog();
  now = 60_001;
  await client.catalog();
  const drawn = await client.callTool('drawBenzene', {});

  expect(first.ok && first.value.tools.map((tool) => tool.name)).toStrictEqual([
    'addNumbers',
    'whoAmI',
    'drawBenzene',
    'explode',
  ]);
  expect(catalogCalls).toBe(2);
  expect(drawn).toStrictEqual({
    ok: true,
    value: {
      result: { name: 'benzene' },
      molecules: [{ smiles: 'c1ccccc1', label: 'benzene' }],
      reactions: [{ rxnCode: 'gFp@DiTt@@@!gFp@DiTt@@@', label: 'benzene' }],
    },
  });
});

test("a refusal carries the server's code, sentence and Retry-After", async () => {
  const client = createToolClient({ baseUrl: server.baseUrl });

  await expect(
    client.callTool('addNumbers', { a: 1, b: 2 }),
  ).resolves.toStrictEqual({
    ok: false,
    failure: {
      kind: 'refused',
      status: 401,
      code: 'no-credentials',
      message: 'Send your token in x-token.',
      retryAfter: null,
    },
  });
  await expect(
    client.callTool(
      'addNumbers',
      { a: 1, b: 2 },
      { headers: { 'x-token': 'busy' } },
    ),
  ).resolves.toStrictEqual({
    ok: false,
    failure: {
      kind: 'refused',
      status: 503,
      code: 'access-unverifiable',
      message: 'Cannot check your token now. Try again in a minute.',
      retryAfter: 60,
    },
  });
});

test('no answer, a late answer, a redirect and an answer outside the contract are told apart', async () => {
  const unreachable = createToolClient({
    baseUrl: 'http://127.0.0.1:1/v1/',
  });
  const silent = createToolClient({
    baseUrl: server.baseUrl,
    timeouts: { tool: 20 },
    fetch: (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(init.signal?.reason as DOMException),
        );
      }),
  });
  let redirect: RequestInit['redirect'];
  const odd = createToolClient({
    baseUrl: server.baseUrl,
    fetch: async (_url, init) => {
      redirect = init.redirect;
      return Response.json({ answer: 42 });
    },
  });

  const failureOf = async (
    result: ReturnType<typeof unreachable.callTool>,
  ): Promise<[string, number | null]> => {
    const read = await result;
    return read.ok ? ['ok', null] : [read.failure.kind, read.failure.status];
  };

  await expect(
    failureOf(unreachable.callTool('addNumbers', {})),
  ).resolves.toStrictEqual(['unreachable', null]);
  await expect(
    failureOf(silent.callTool('addNumbers', {})),
  ).resolves.toStrictEqual(['timeout', null]);
  await expect(
    failureOf(odd.callTool('addNumbers', {})),
  ).resolves.toStrictEqual(['invalid-reply', 200]);
  expect(redirect).toBe('manual');
});
