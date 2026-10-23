import { fastify } from 'fastify';
import { afterAll, expect, test } from 'vitest';

import {
  SAMPLE_TOKEN,
  additionTool,
  identityTool,
  refusingTool,
  resolveSampleContext,
} from '../../__tests__/sampleTools.ts';
import type { ToolExample } from '../../contract/index.ts';
import { createToolRoutes } from '../../fastify/mcpRoutes.ts';
import {
  checkToolExamples,
  injectMcpRequest,
  injectToolCall,
} from '../index.ts';

const EXAMPLES: ToolExample[] = [
  { question: 'What is 2 + 3?', expect: '5', tools: ['addNumbers'] },
  {
    question: 'Add 40 and 2, then 1 and 1',
    expect: ['42'],
    tools: ['addNumbers'],
  },
];

const app = fastify();
await app.register(
  createToolRoutes({
    name: 'sample',
    version: '1.0.0',
    tools: [additionTool, identityTool, refusingTool],
    resolveContext: (request) =>
      request.headers['x-token'] === undefined
        ? { ok: true, context: { email: 'nobody@example.org' } }
        : resolveSampleContext(request),
  }),
  { prefix: '/api' },
);

afterAll(async () => {
  await app.close();
});

test('a tool is called on its JSON route, with the headers given', async () => {
  const sum = await injectToolCall(
    app,
    'addNumbers',
    { a: 1, b: 2 },
    { prefix: '/api' },
  );
  const identity = await injectToolCall(
    app,
    'whoAmI',
    {},
    { prefix: '/api', headers: { 'x-token': SAMPLE_TOKEN } },
  );

  expect([sum.statusCode, sum.json()]).toStrictEqual([
    200,
    { result: { sum: 3 }, molecules: [] },
  ]);
  expect(identity.json()).toStrictEqual({
    result: { email: 'alice@example.org' },
    molecules: [],
  });
});

test('an MCP request carries the headers of an MCP client', async () => {
  const response = await injectMcpRequest(
    app,
    {
      method: 'tools/call',
      params: { name: 'addNumbers', arguments: { a: 4, b: 5 } },
      id: 7,
    },
    { prefix: '/api' },
  );

  expect([response.statusCode, response.json()]).toStrictEqual([
    200,
    {
      jsonrpc: '2.0',
      id: 7,
      result: { content: [{ type: 'text', text: '{\n  "sum": 9\n}' }] },
    },
  ]);
});

test('an MCP request without params sends none, with id 1', async () => {
  const response = await injectMcpRequest(
    app,
    { method: 'tools/list' },
    { prefix: '/api' },
  );
  const body = response.json<{
    id: number;
    result: { tools: Array<{ name: string }> };
  }>();

  expect([body.id, body.result.tools.map(({ name }) => name)]).toStrictEqual([
    1,
    ['addNumbers', 'whoAmI', 'loading'],
  ]);
});

test('examples answered by their calls have no problem', async () => {
  const problems = await checkToolExamples({
    examples: EXAMPLES,
    calls: {
      'What is 2 + 3?': { tool: 'addNumbers', arguments: { a: 2, b: 3 } },
      'Add 40 and 2, then 1 and 1': {
        tool: 'addNumbers',
        arguments: { a: 40, b: 2 },
      },
    },
    app,
    prefix: '/api',
  });

  expect(problems).toStrictEqual([]);
});

test('each problem is one sentence naming its question', async () => {
  const problems = await checkToolExamples({
    examples: [
      ...EXAMPLES,
      { question: 'Is it loaded?', expect: 'yes', tools: ['loading'] },
      { question: 'Who am I?', expect: 'alice', tools: ['whoAmI'] },
    ],
    calls: {
      'What is 2 + 3?': { tool: 'addNumbers', arguments: { a: 2, b: 2 } },
      'Is it loaded?': { tool: 'loading', arguments: {} },
      'Who am I?': { tool: 'addNumbers', arguments: { a: 0, b: 0 } },
      'What is 1 + 1?': { tool: 'addNumbers', arguments: { a: 1, b: 1 } },
    },
    app,
    prefix: '/api',
  });

  expect(problems).toStrictEqual([
    '"What is 1 + 1?" has a call, but is no example.',
    '"What is 2 + 3?": the result does not contain "5".',
    '"Add 40 and 2, then 1 and 1" has no call.',
    '"Is it loaded?": loading answered 503: The copy is loading. Try again in a minute.',
    '"Who am I?" calls addNumbers, which the example does not name (whoAmI).',
    '"Who am I?": the result does not contain "alice".',
  ]);
});

test('the prefix is /v1 unless said otherwise', async () => {
  const server = fastify();
  await server.register(
    createToolRoutes({ name: 'v1', version: '1.0.0', tools: [additionTool] }),
    { prefix: '/v1' },
  );
  const response = await injectToolCall(server, 'addNumbers', { a: 1, b: 1 });
  const problems = await checkToolExamples({
    examples: [{ question: '1 + 1?', expect: '2', tools: ['addNumbers'] }],
    calls: { '1 + 1?': { tool: 'addNumbers', arguments: { a: 1, b: 1 } } },
    app: server,
  });
  await server.close();

  expect([response.statusCode, problems]).toStrictEqual([200, []]);
});
