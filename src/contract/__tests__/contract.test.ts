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
