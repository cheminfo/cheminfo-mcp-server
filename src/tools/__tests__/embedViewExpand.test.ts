import { expect, test } from 'vitest';

import { embedMeta } from '../embedView.ts';

import type { FakeFrame } from './shellStandIns.ts';
import {
  CARD,
  FULL,
  INLINE,
  MODES,
  PAGE,
  methods,
  settle,
  sizes,
  startShell,
} from './shellStandIns.ts';

const EXPAND = { type: 'cheminfo:embed-expand' };
const COLLAPSE = { type: 'cheminfo:embed-collapse' };

test('over the full screen the full page is shown, and kept', async () => {
  const shell = startShell();
  await shell.start({
    availableDisplayModes: MODES,
    containerDimensions: INLINE,
  });
  shell.answer(embedMeta(CARD, { page: PAGE }));
  shell.fromCard({ type: 'cheminfo:embed-height', height: 180 });
  shell.changeContext({ displayMode: 'fullscreen', containerDimensions: FULL });

  expect(shell.appended).toHaveLength(1);

  const page = shell.appended[0] as FakeFrame;

  expect(page.getAttribute('src')).toBe(PAGE);
  expect(page.getAttribute('allow')).toBe('fullscreen *; clipboard-write *');
  expect(page.title).toBe('site.example');
  expect(page.hidden).toBe(false);
  expect(page.style.height).toBe('900px');
  expect(shell.card.hidden).toBe(true);

  shell.changeContext({ displayMode: 'inline', containerDimensions: INLINE });
  shell.changeContext({ displayMode: 'fullscreen', containerDimensions: FULL });

  expect(shell.appended).toStrictEqual([page]);
  expect(page.hidden).toBe(false);

  // The full page already shows: a request from the hidden card does nothing.
  shell.activation.isActive = true;
  shell.fromCard(EXPAND);
  shell.changeContext({ displayMode: 'inline', containerDimensions: INLINE });

  expect(page.hidden).toBe(true);
  expect(shell.card.hidden).toBe(false);
  expect(shell.card.style.height).toBe('180px');
  expect(sizes(shell.sent)).toStrictEqual([120, 180]);
  expect(methods(shell.sent)).toStrictEqual([
    'ui/initialize',
    'ui/notifications/initialized',
    'ui/notifications/size-changed',
    'ui/notifications/size-changed',
  ]);
});

test('a click in the card gets the full screen, and the full page in it', async () => {
  const shell = startShell();
  await shell.start({
    availableDisplayModes: MODES,
    containerDimensions: INLINE,
  });
  shell.answer(embedMeta(CARD, { page: PAGE }));
  shell.activation.isActive = true;
  shell.fromCard(EXPAND);

  expect(shell.sent.at(-1)).toStrictEqual({
    jsonrpc: '2.0',
    id: 2,
    method: 'ui/request-display-mode',
    params: { mode: 'fullscreen' },
  });

  shell.fromHost({ id: 2, result: { mode: 'fullscreen' } });
  await settle();

  expect(shell.appended).toHaveLength(1);
  expect(shell.appended[0]?.getAttribute('src')).toBe(PAGE);
  expect(shell.appended[0]?.style.height).toBe('100vh');
  expect(shell.card.hidden).toBe(true);
});

test('a request without a click, or refused, keeps the card inline', async () => {
  const shell = startShell();
  await shell.start({
    availableDisplayModes: MODES,
    containerDimensions: INLINE,
  });
  shell.answer(embedMeta(CARD, { page: PAGE }));
  shell.fromCard(EXPAND);

  expect(methods(shell.sent)).toStrictEqual([
    'ui/initialize',
    'ui/notifications/initialized',
    'ui/notifications/size-changed',
  ]);

  shell.activation.isActive = true;
  shell.fromCard(EXPAND);
  shell.fromHost({ id: 2, result: { mode: 'inline' } });
  shell.fromCard(EXPAND);
  shell.fromHost({ id: 3, error: { code: -32_000, message: 'Not now.' } });
  await settle();

  expect(methods(shell.sent).slice(3)).toStrictEqual([
    'ui/request-display-mode',
    'ui/request-display-mode',
  ]);
  expect(shell.card.hidden).toBe(false);
  expect(shell.appended).toHaveLength(0);
});

test('a host without a full screen opens the site page instead', async () => {
  const shell = startShell();
  await shell.start({ availableDisplayModes: ['inline'] });
  shell.answer(embedMeta(CARD, { page: `${PAGE}&hide=filters` }));
  shell.activation.isActive = true;
  shell.fromCard(EXPAND);

  expect(shell.sent.at(-1)).toStrictEqual({
    jsonrpc: '2.0',
    id: 2,
    method: 'ui/open-link',
    params: { url: 'https://site.example/ph?acid=HCl' },
  });
});

test('a card already over the full screen opens the site page', async () => {
  const shell = startShell();
  await shell.start({
    displayMode: 'fullscreen',
    availableDisplayModes: MODES,
    containerDimensions: FULL,
  });
  shell.answer(embedMeta(CARD));

  expect(shell.card.hidden).toBe(false);
  expect(shell.card.style.height).toBe('900px');

  shell.activation.isActive = true;
  shell.fromCard(EXPAND);

  expect(shell.sent.at(-1)).toStrictEqual({
    jsonrpc: '2.0',
    id: 2,
    method: 'ui/open-link',
    params: { url: 'https://site.example/ph?acid=HCl' },
  });
  expect(shell.appended).toHaveLength(0);
});

test('Escape in the full page or the card leaves the full screen', async () => {
  const shell = startShell();
  await shell.start({
    availableDisplayModes: MODES,
    containerDimensions: INLINE,
  });
  shell.answer(embedMeta(CARD, { page: PAGE }));
  shell.fromCard(COLLAPSE);
  shell.changeContext({ displayMode: 'fullscreen', containerDimensions: FULL });
  const page = shell.appended[0] as FakeFrame;
  shell.fromWindow(page.contentWindow, {
    type: 'cheminfo:embed-height',
    height: 50,
  });
  shell.activation.isActive = true;
  shell.fromWindow(page.contentWindow, EXPAND);
  shell.fromWindow(page.contentWindow, COLLAPSE);

  expect(shell.sent.at(-1)).toStrictEqual({
    jsonrpc: '2.0',
    id: 2,
    method: 'ui/request-display-mode',
    params: { mode: 'inline' },
  });

  shell.fromHost({ id: 2, result: { mode: 'inline' } });
  shell.changeContext({ displayMode: 'inline', containerDimensions: INLINE });
  shell.fromWindow(page.contentWindow, COLLAPSE);
  shell.changeContext({ displayMode: 'fullscreen', containerDimensions: FULL });
  shell.fromCard(COLLAPSE);

  expect(methods(shell.sent).slice(3)).toStrictEqual([
    'ui/request-display-mode',
    'ui/request-display-mode',
  ]);
  expect(shell.sent.at(-1)?.params).toStrictEqual({ mode: 'inline' });
  expect(sizes(shell.sent)).toStrictEqual([120]);
});
