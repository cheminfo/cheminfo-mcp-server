import { expect, test } from 'vitest';

import { EMBED_META_KEY, embedMeta } from '../embedView.ts';

import {
  CARD,
  FULL,
  INLINE,
  MODES,
  PAGE,
  fakeWindow,
  methods,
  settle,
  sizes,
  startShell,
} from './shellStandIns.ts';

// Written in two parts, so that no linter reads a script address here.
const SCRIPT_SCHEME = 'javascript';

const NO_PAGE = {
  hidden: false,
  textContent: 'This answer has no page to show.',
};

test('an answer without a page of the view origins shows nothing', async () => {
  const shell = startShell();
  await shell.start({});
  shell.answer({ [EMBED_META_KEY]: { url: 'https://elsewhere.example/' } });

  expect(shell.card.hidden).toBe(true);
  expect(shell.card.getAttribute('src')).toBeNull();
  expect(shell.status).toStrictEqual(NO_PAGE);
});

test('a frame loads the address as it was checked, and only an http(s) one', async () => {
  const shell = startShell();
  await shell.start({});
  shell.answer({
    [EMBED_META_KEY]: { url: 'https:/site.example/../any/path?x=1' },
  });

  expect(shell.card.getAttribute('src')).toBe(
    'https://site.example/any/path?x=1',
  );

  for (const url of [
    'blob:https://site.example/0b3f6c7e-0000-4000-8000-000000000000',
    `${SCRIPT_SCHEME}:alert(1)`,
    'https://site.example.evil.example/card',
    42,
  ]) {
    shell.answer({ [EMBED_META_KEY]: { url } });

    expect(shell.status).toStrictEqual(NO_PAGE);
  }

  expect(shell.card.getAttribute('src')).toBe(
    'https://site.example/any/path?x=1',
  );
});

test('a full page outside the view origins is never framed', async () => {
  const shell = startShell();
  await shell.start({
    availableDisplayModes: MODES,
    containerDimensions: INLINE,
  });
  shell.answer(embedMeta(CARD, { page: 'https://elsewhere.example/ph' }));
  shell.changeContext({ displayMode: 'fullscreen', containerDimensions: FULL });

  expect(shell.appended).toHaveLength(0);
  expect(shell.card.hidden).toBe(false);
  expect(shell.card.style.height).toBe('900px');
});

test('a message from another window is ignored', async () => {
  const shell = startShell();
  await shell.start({ containerDimensions: INLINE });
  shell.answer(embedMeta(CARD));
  const stranger = fakeWindow();
  shell.fromWindow(stranger, { type: 'cheminfo:embed-height', height: 300 });
  shell.fromWindow(stranger, {
    jsonrpc: '2.0',
    method: 'ui/notifications/tool-result',
    params: { _meta: embedMeta('https://site.example/other') },
  });
  shell.fromWindow(stranger, { jsonrpc: '2.0', id: 9, method: 'ui/ping' });
  shell.fromCard(null);
  shell.fromCard({ type: 42 });

  expect(shell.card.getAttribute('src')).toBe(CARD);
  expect(sizes(shell.sent)).toStrictEqual([120]);
  expect(shell.sent).toHaveLength(3);
});

test('a request of the host is answered with an empty result', async () => {
  const shell = startShell();
  await shell.start({});
  shell.fromHost({ id: 7, method: 'ui/resource-teardown', params: {} });

  expect(shell.sent.at(-1)).toStrictEqual({
    jsonrpc: '2.0',
    id: 7,
    result: {},
  });
});

test('a new full page replaces the frame of the former one', async () => {
  const shell = startShell();
  await shell.start({
    displayMode: 'fullscreen',
    availableDisplayModes: MODES,
    containerDimensions: FULL,
  });
  shell.answer(embedMeta(CARD, { page: PAGE }));
  shell.answer(embedMeta(CARD, { page: `${PAGE}&base=NaOH` }));

  expect(shell.appended).toHaveLength(2);
  expect(shell.appended[0]?.isRemoved).toBe(true);
  expect(shell.appended[1]?.getAttribute('src')).toBe(`${PAGE}&base=NaOH`);
  expect(shell.appended[1]?.hidden).toBe(false);

  shell.answer({ [EMBED_META_KEY]: { url: 'https://elsewhere.example/' } });
  shell.answer(embedMeta(CARD, { page: PAGE }));

  expect(shell.appended).toHaveLength(3);
  expect(shell.appended[1]?.isRemoved).toBe(true);
  expect(shell.appended[2]?.getAttribute('src')).toBe(PAGE);
});

test('an error answering the start shows that the host did not answer', async () => {
  const shell = startShell();
  shell.fromHost({ id: 1, error: { code: -32_601, message: 'Unknown.' } });
  await settle();

  expect(shell.status).toStrictEqual({
    hidden: false,
    textContent: 'The host did not answer.',
  });
  expect(methods(shell.sent)).toStrictEqual(['ui/initialize']);
});

test('a cancelled call says so', async () => {
  const shell = startShell();
  await shell.start({});
  shell.fromHost({ method: 'ui/notifications/tool-cancelled', params: {} });

  expect(shell.status).toStrictEqual({
    hidden: false,
    textContent: 'The call was cancelled.',
  });
});
