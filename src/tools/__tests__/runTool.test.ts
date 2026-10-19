import { expect, test, vi } from 'vitest';

import { SAMPLE_TOOLS } from '../../__tests__/sampleTools.ts';
import { TOOL_FAILED, runTool } from '../runTool.ts';

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
