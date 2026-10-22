import { expect, test, vi } from 'vitest';
import { z } from 'zod';

import { SAMPLE_TOOLS } from '../../__tests__/sampleTools.ts';
import { MAX_CURVES } from '../../contract/index.ts';
import { TOOL_FAILED, runTool } from '../runTool.ts';
import { defineTool } from '../types.ts';

const ALICE = { email: 'alice@example.org' };

test('a call answers the result, the molecules always and the other side channels when they hold something', async () => {
  await expect(
    runTool(SAMPLE_TOOLS, 'addNumbers', { a: 1, b: 2 }, ALICE),
  ).resolves.toStrictEqual({
    ok: true,
    reply: { result: { sum: 3 }, molecules: [] },
  });
  await expect(
    runTool(SAMPLE_TOOLS, 'drawBenzene', {}, ALICE),
  ).resolves.toStrictEqual({
    ok: true,
    reply: {
      result: { name: 'benzene' },
      molecules: [{ smiles: 'c1ccccc1', label: 'benzene' }],
      reactions: [{ rxnCode: 'gFp@DiTt@@@!gFp@DiTt@@@', label: 'benzene' }],
    },
  });
  await expect(
    runTool(SAMPLE_TOOLS, 'whoAmI', {}, ALICE),
  ).resolves.toStrictEqual({
    ok: true,
    reply: { result: { email: 'alice@example.org' }, molecules: [] },
  });
});

test('an unknown tool, invalid arguments and a tool that throws are refused', async () => {
  const onError = vi.fn();

  await expect(
    runTool(SAMPLE_TOOLS, 'deleteAll', {}, ALICE),
  ).resolves.toStrictEqual({
    ok: false,
    refusal: {
      status: 404,
      code: 'not-found',
      error: 'Unknown tool: deleteAll',
    },
  });
  await expect(
    runTool(SAMPLE_TOOLS, 'addNumbers', { a: 1 }, ALICE),
  ).resolves.toStrictEqual({
    ok: false,
    refusal: {
      status: 400,
      code: 'invalid-arguments',
      error:
        'Invalid arguments for addNumbers: ✖ Invalid input: expected number, received undefined\n  → at b. Expected parameters: a, b.',
    },
  });
  await expect(
    runTool(SAMPLE_TOOLS, 'explode', {}, ALICE, { onError }),
  ).resolves.toStrictEqual({
    ok: false,
    refusal: { status: 500, code: 'internal', error: TOOL_FAILED },
  });
  expect(onError).toHaveBeenCalledOnce();
  expect(onError.mock.calls[0]?.[1]).toBe('explode');
});

test("a ToolRefusalError is the caller's answer, and no failure", async () => {
  const onError = vi.fn();

  await expect(
    runTool(SAMPLE_TOOLS, 'loading', {}, ALICE, { onError }),
  ).resolves.toStrictEqual({
    ok: false,
    refusal: {
      status: 503,
      code: 'loading',
      error: 'The copy is loading. Try again in a minute.',
      retryAfter: 30,
      extra: { mirror: { state: 'catching-up', progress: 0.4 } },
    },
  });
  await expect(
    runTool(SAMPLE_TOOLS, 'deleteAll', {}, ALICE, {
      unknownToolMessage: (name) => `No ${name} here.`,
    }),
  ).resolves.toStrictEqual({
    ok: false,
    refusal: { status: 404, code: 'not-found', error: 'No deleteAll here.' },
  });
  expect(onError).not.toHaveBeenCalled();
});

test('the curves a tool draws reach the reply, at most eight', async () => {
  const curve = {
    title: 'Titration of NaOH by HCl',
    x: {
      title: 'Volume (mL)',
      symbol: 'V',
      unit: 'mL',
      decimals: 2,
      values: [0, 10],
    },
    y: {
      title: 'pH',
      symbol: 'pH',
      decimals: 2,
      values: [13, 7],
      range: [0, 14] as [number, number],
    },
  };
  const titrate = defineTool({
    name: 'titrate',
    title: 'Titrate',
    description: 'Draw a titration curve.',
    schema: z.strictObject({}),
    execute: () => ({
      result: { equivalence: '10.00 mL' },
      curves: Array.from({ length: MAX_CURVES + 2 }, () => curve),
    }),
  });

  const run = await runTool([titrate], 'titrate', {}, ALICE);

  expect(run.ok && run.reply.curves).toHaveLength(MAX_CURVES);
  expect(run.ok && run.reply.curves?.[0]).toStrictEqual(curve);
});
