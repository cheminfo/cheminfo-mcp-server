import { expect, test } from 'vitest';

import {
  REFUSAL_CODES,
  refuseBusy,
  refuseInvalid,
  refuseNotFound,
  refuseTimeout,
} from '../refusals.ts';
import { ToolRefusalError } from '../types.ts';

function refusalOf(refuse: () => never) {
  try {
    refuse();
  } catch (error) {
    if (error instanceof ToolRefusalError) return error.refusal;
    throw error;
  }
  return undefined;
}

test('each helper throws the refusal of its code', () => {
  expect([
    refusalOf(() => refuseInvalid('Give a formula, e.g. C6H6.')),
    refusalOf(() => refuseNotFound('No compound is called "foo".')),
    refusalOf(() => refuseBusy('Two calls are running: try again soon.')),
    refusalOf(() => refuseBusy('The copy is loading.', 30)),
    refusalOf(() => refuseTimeout('This took longer than 10 s.')),
  ]).toStrictEqual([
    {
      status: 400,
      code: 'invalid-arguments',
      error: 'Give a formula, e.g. C6H6.',
    },
    { status: 404, code: 'not-found', error: 'No compound is called "foo".' },
    {
      status: 503,
      code: 'busy',
      error: 'Two calls are running: try again soon.',
      retryAfter: 5,
    },
    {
      status: 503,
      code: 'busy',
      error: 'The copy is loading.',
      retryAfter: 30,
    },
    { status: 422, code: 'timeout', error: 'This took longer than 10 s.' },
  ]);
});

test('every code is listed once, with its status', () => {
  expect(REFUSAL_CODES.map(({ code, status }) => [code, status])).toStrictEqual(
    [
      ['invalid-arguments', 400],
      ['not-found', 404],
      ['timeout', 422],
      ['internal', 500],
      ['busy', 503],
    ],
  );
});
