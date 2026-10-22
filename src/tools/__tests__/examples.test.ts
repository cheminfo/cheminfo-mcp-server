import { fastify } from 'fastify';
import { expect, test } from 'vitest';
import { z } from 'zod';

import { ToolCatalogSchema } from '../../contract/index.ts';
import { createToolRoutes } from '../../fastify/mcpRoutes.ts';
import { defineTool } from '../types.ts';

const ph = defineTool({
  name: 'solutionPh',
  title: 'pH of a solution',
  description: 'The pH of a solution.',
  schema: z.strictObject({ acid: z.string() }),
  execute: () => ({ result: { pH: '2.85' } }),
});

const EXAMPLE = {
  question: 'What is the pH of 0.1 M acetic acid?',
  expect: '2.85',
  tools: ['solutionPh'],
  category: 'Solutions',
};

async function catalogOf(examples?: Array<typeof EXAMPLE>) {
  const app = fastify();
  await app.register(
    createToolRoutes({
      name: 'equilibrium',
      version: '1.0.0',
      tools: [ph],
      ...(examples !== undefined && { examples }),
    }),
    { prefix: '/v1' },
  );
  const response = await app.inject({ url: '/v1/tools' });
  await app.close();
  return response.json<Record<string, unknown>>();
}

test('GET tools lists the example questions a server answers', async () => {
  const catalog = await catalogOf([EXAMPLE]);

  expect(catalog.examples).toStrictEqual([EXAMPLE]);
  expect(ToolCatalogSchema.parse(catalog).examples).toStrictEqual([EXAMPLE]);
});

test('a server without examples keeps the catalog it had, version included', async () => {
  const without = await catalogOf();
  const empty = await catalogOf([]);
  const withOne = await catalogOf([EXAMPLE]);

  expect(
    Object.keys(without).toSorted((a, b) => a.localeCompare(b)),
  ).toStrictEqual(['instructions', 'tools', 'version']);
  expect(empty).toStrictEqual(without);
  expect(withOne.version).not.toBe(without.version);
});

test('a malformed list of examples is dropped, never the catalog', () => {
  const parsed = ToolCatalogSchema.parse({
    version: 'abc',
    tools: [],
    instructions: '',
    examples: [{ question: 'No expected answer', tools: ['solutionPh'] }],
  });

  expect(parsed).toStrictEqual({
    version: 'abc',
    tools: [],
    instructions: '',
    examples: undefined,
  });
});
