import { expect, test } from 'vitest';

import { ErrorReplySchema, ToolRunReplySchema } from '../index.ts';

test('a malformed side channel is dropped, never the answer the model reads', () => {
  const parsed = ToolRunReplySchema.parse({
    result: { sum: 3 },
    molecules: [{ smiles: 42 }],
    reactions: [{ label: 'no scheme' }],
    spectra: 'not a list',
  });

  expect(parsed).toStrictEqual({
    result: { sum: 3 },
    molecules: [],
    reactions: undefined,
    spectra: undefined,
  });
});

test('a curve is kept whole, and a curve whose axes differ in length is dropped', () => {
  const curve = {
    title: 'Titration of NaOH by HCl',
    x: {
      title: 'Volume of HCl added (mL)',
      symbol: 'V',
      unit: 'mL',
      decimals: 2,
      values: [0, 5, 10],
    },
    y: {
      title: 'pH',
      symbol: 'pH',
      decimals: 2,
      values: [13, 12.52, 7],
      range: [0, 14],
    },
  };

  expect(
    ToolRunReplySchema.parse({ result: {}, molecules: [], curves: [curve] })
      .curves,
  ).toStrictEqual([curve]);
  expect(
    ToolRunReplySchema.parse({
      result: {},
      molecules: [],
      curves: [{ ...curve, y: { ...curve.y, values: [13, 7] } }],
    }).curves,
  ).toBeUndefined();
});

test('a refusal keeps the fields a server adds', () => {
  expect(
    ErrorReplySchema.parse({
      error: 'The copy is loading.',
      code: 'loading',
      mirror: { state: 'catching-up' },
    }),
  ).toStrictEqual({
    error: 'The copy is loading.',
    code: 'loading',
    mirror: { state: 'catching-up' },
  });
});
