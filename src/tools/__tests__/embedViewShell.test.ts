import { expect, test } from 'vitest';

import { embedMeta } from '../embedView.ts';

import {
  CARD,
  FULL,
  INLINE,
  MODES,
  PAGE,
  settle,
  sizes,
  startShell,
} from './shellStandIns.ts';

test('inline, the card fits its content within the height the host allows', async () => {
  const shell = startShell();

  expect(shell.sent[0]).toStrictEqual({
    jsonrpc: '2.0',
    id: 1,
    method: 'ui/initialize',
    params: {
      protocolVersion: '2026-01-26',
      appInfo: { name: 'site.example', version: '1.0.0' },
      appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
    },
  });

  shell.fromHost({
    id: 1,
    result: {
      hostContext: {
        displayMode: 'inline',
        availableDisplayModes: MODES,
        containerDimensions: INLINE,
      },
    },
  });
  await settle();
  shell.answer(embedMeta(CARD, { page: PAGE }));

  expect(shell.sent[1]).toStrictEqual({
    jsonrpc: '2.0',
    method: 'ui/notifications/initialized',
    params: {},
  });
  expect(shell.card.hidden).toBe(false);
  expect(shell.card.getAttribute('src')).toBe(CARD);
  expect(shell.status.hidden).toBe(true);
  expect(shell.card.style.height).toBe('120px');

  shell.fromCard({ type: 'cheminfo:embed-height', height: 212.4 });

  expect(shell.card.style.height).toBe('213px');

  shell.fromCard({ type: 'cheminfo:embed-height', height: 2400 });

  expect(shell.card.style.height).toBe('500px');

  shell.changeContext({ containerDimensions: { width: 958, maxHeight: 900 } });

  expect(shell.card.style.height).toBe('900px');
  expect(sizes(shell.sent)).toStrictEqual([120, 213, 500, 900]);
  expect(shell.appended).toHaveLength(0);
});

test('a card that does not report is folded to a line linking to its page, and comes back when it reports', async () => {
  const shell = startShell();
  await shell.start({ containerDimensions: INLINE });
  shell.answer(embedMeta(CARD, { page: PAGE }));
  for (const timer of shell.timers) timer();

  expect(shell.card.style.height).toBe('0px');
  expect(shell.note.hidden).toBe(false);
  expect(sizes(shell.sent)).toStrictEqual([120, 44]);

  shell.clickOpen();

  expect(shell.sent.at(-1)).toMatchObject({
    method: 'ui/open-link',
    params: { url: 'https://site.example/ph?acid=HCl' },
  });

  shell.fromCard({ type: 'cheminfo:embed-height', height: 200 });

  expect(shell.card.style.height).toBe('200px');
  expect(shell.note.hidden).toBe(true);
  expect(sizes(shell.sent)).toStrictEqual([120, 44, 200]);
});

test('a view that sets a height frames a card that never reports at it', async () => {
  const shell = startShell(undefined, 640);
  await shell.start({});
  shell.answer(embedMeta(CARD));
  for (const timer of shell.timers) timer();

  expect(shell.card.style.height).toBe('640px');
  expect(shell.note.hidden).toBe(true);
  expect(sizes(shell.sent)).toStrictEqual([120, 640]);
});

test('a height reported before the default applies is kept', async () => {
  const shell = startShell();
  await shell.start({ containerDimensions: INLINE });
  shell.answer(embedMeta(CARD));
  shell.fromCard({ type: 'cheminfo:embed-height', height: 180 });
  for (const timer of shell.timers) timer();

  expect(shell.timers).toHaveLength(1);
  expect(shell.card.style.height).toBe('180px');
  expect(sizes(shell.sent)).toStrictEqual([120, 180]);
});

test('a height the host fixes inline is the card frame height', async () => {
  const shell = startShell();
  await shell.start({
    displayMode: 'inline',
    availableDisplayModes: ['inline'],
    containerDimensions: { width: 900, height: 400 },
  });
  shell.answer(embedMeta(CARD, { page: PAGE }));
  shell.fromCard({ type: 'cheminfo:embed-height', height: 900 });
  for (const timer of shell.timers) timer();

  expect(shell.card.style.height).toBe('400px');
  expect(sizes(shell.sent)).toStrictEqual([400]);

  shell.changeContext({ containerDimensions: { width: 900, maxHeight: 700 } });

  expect(shell.card.style.height).toBe('700px');
  expect(sizes(shell.sent)).toStrictEqual([400, 700]);
});

test('a card hidden by the full page keeps a height it measures, and measures again once shown', async () => {
  const shell = startShell();
  await shell.start({
    availableDisplayModes: MODES,
    containerDimensions: INLINE,
  });
  shell.answer(embedMeta(CARD, { page: PAGE }));
  shell.fromCard({ type: 'cheminfo:embed-height', height: 100 });
  shell.changeContext({ displayMode: 'fullscreen', containerDimensions: FULL });

  expect(shell.card.hidden).toBe(true);

  // Not laid out while hidden (Chromium): no height.
  shell.fromCard({ type: 'cheminfo:embed-height', height: 0 });
  // Laid out while hidden (WebKit): its height.
  shell.fromCard({ type: 'cheminfo:embed-height', height: 300 });

  expect(shell.card.contentWindow.posted).toStrictEqual([]);
  expect(sizes(shell.sent)).toStrictEqual([120, 100]);

  shell.changeContext({ displayMode: 'inline', containerDimensions: INLINE });

  expect(shell.card.hidden).toBe(false);
  expect(shell.card.style.height).toBe('300px');
  expect(shell.card.contentWindow.posted).toStrictEqual([
    { type: 'cheminfo:embed-measure' },
  ]);

  shell.fromCard({ type: 'cheminfo:embed-height', height: 280 });
  shell.changeContext({ containerDimensions: { width: 700, maxHeight: 500 } });

  expect(shell.card.style.height).toBe('280px');
  expect(sizes(shell.sent)).toStrictEqual([120, 100, 300, 280]);
  expect(shell.card.contentWindow.posted).toHaveLength(1);
});
