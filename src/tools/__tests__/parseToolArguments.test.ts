import { expect, test } from 'vitest';
import { z } from 'zod';

import { parseToolArguments } from '../parseToolArguments.ts';

const single = { name: 'mfInfo', schema: z.strictObject({ mf: z.string() }) };
const pair = {
  name: 'addNumbers',
  schema: z.strictObject({ a: z.number(), b: z.number().optional() }),
};

test('a parameter set to null is left out', () => {
  expect(parseToolArguments(pair, { a: 1, b: null })).toStrictEqual({
    success: true,
    data: { a: 1 },
  });
});

test("a single value under another name goes to the tool's only parameter", () => {
  expect(parseToolArguments(single, { formula: 'C6H6' })).toStrictEqual({
    success: true,
    data: { mf: 'C6H6' },
  });
});

test('a value under another name goes to the one required parameter, beside the optional ones', () => {
  const element = {
    name: 'elementProperties',
    schema: z.strictObject({
      element: z.string(),
      only: z.array(z.enum(['atomicWeight'])).optional(),
    }),
  };

  expect(parseToolArguments(element, { symbol: 'Au' })).toStrictEqual({
    success: true,
    data: { element: 'Au' },
  });
  expect(
    parseToolArguments(element, { symbol: 'Au', only: ['atomicWeight'] }),
  ).toStrictEqual({
    success: true,
    data: { element: 'Au', only: ['atomicWeight'] },
  });
});

test('nothing moves when the main parameter is unclear or already given', () => {
  const twoRequired = {
    name: 'addNumbers',
    schema: z.strictObject({ a: z.number(), b: z.number() }),
  };

  const parsed = parseToolArguments(twoRequired, { x: 1 });

  expect(parsed.success).toBe(false);
  expect(parsed.success ? '' : parsed.error).toContain('Unrecognized key: "x"');
});

test('anything else is refused with the explanation and the parameters', () => {
  expect(parseToolArguments(pair, { a: 1, c: 2 })).toStrictEqual({
    success: false,
    error:
      'Invalid arguments for addNumbers: ✖ Unrecognized key: "c". Expected parameters: a, b.',
  });
  expect(parseToolArguments(pair, ['a'])).toStrictEqual({
    success: false,
    error:
      'Invalid arguments for addNumbers: give the parameters as an object. Expected parameters: a, b.',
  });
});
