import { afterEach, expect, test, vi } from 'vitest';

import type {
  EmbedMessageEvent,
  EmbedMessageSource,
  SizeObserver,
} from '../index.ts';
import {
  EMBED_COLLAPSE_MESSAGE,
  EMBED_EXPAND_MESSAGE,
  EMBED_HEIGHT_MESSAGE,
  EMBED_MEASURE_MESSAGE,
  isFramed,
  reportEmbedHeight,
  requestEmbedExpand,
} from '../index.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

function recorder() {
  const posted: unknown[] = [];
  return {
    posted,
    target: {
      postMessage: (message: unknown) => {
        posted.push(message);
      },
    },
  };
}

test('the height is posted now and on every change, once per value', () => {
  const { posted, target } = recorder();
  let height = 211.2;
  const observed: { callback?: () => void } = {};
  let isDisconnected = false;
  class Observer implements SizeObserver {
    constructor(callback: () => void) {
      observed.callback = callback;
    }

    observe() {
      return undefined;
    }

    disconnect() {
      isDisconnected = true;
    }
  }
  const stop = reportEmbedHeight(
    { getBoundingClientRect: () => ({ height }) },
    { target, ResizeObserver: Observer },
  );
  observed.callback?.();
  height = 340;
  observed.callback?.();
  stop();

  expect(posted).toStrictEqual([
    { type: 'cheminfo:embed-height', height: 212 },
    { type: 'cheminfo:embed-height', height: 340 },
  ]);
  expect(isDisconnected).toBe(true);
  expect(EMBED_HEIGHT_MESSAGE).toBe('cheminfo:embed-height');
});

test('a missing element reports nothing', () => {
  const { posted, target } = recorder();

  expect(reportEmbedHeight(null, { target })()).toBeUndefined();
  expect(reportEmbedHeight(undefined, { target })()).toBeUndefined();
  expect(posted).toStrictEqual([]);
});

test('without a ResizeObserver the height is posted once, and again when the view asks', () => {
  const { posted, target } = recorder();
  const listeners = new Set<(event: EmbedMessageEvent) => void>();
  const messages: EmbedMessageSource = {
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
  };
  const dispatch = (source: unknown, data: unknown) => {
    for (const listener of listeners) listener({ source, data });
  };
  const stop = reportEmbedHeight(
    { getBoundingClientRect: () => ({ height: 99.5 }) },
    { target, messages },
  );
  dispatch(target, { type: 'cheminfo:embed-measure' });
  dispatch({}, { type: 'cheminfo:embed-measure' });
  dispatch(target, { type: 'cheminfo:embed-height', height: 10 });
  dispatch(target, null);
  stop();
  dispatch(target, { type: 'cheminfo:embed-measure' });

  expect(posted).toStrictEqual([
    { type: 'cheminfo:embed-height', height: 100 },
    { type: 'cheminfo:embed-height', height: 100 },
  ]);
  expect(listeners.size).toBe(0);
  expect(EMBED_MEASURE_MESSAGE).toBe('cheminfo:embed-measure');
  expect(EMBED_COLLAPSE_MESSAGE).toBe('cheminfo:embed-collapse');
});

test('a page that is not framed posts nothing', () => {
  expect(isFramed()).toBe(false);

  const stop = reportEmbedHeight({
    getBoundingClientRect: () => ({ height: 10 }),
  });

  expect(stop()).toBeUndefined();
  expect(requestEmbedExpand()).toBeUndefined();
});

test('a framed page posts to its parent', () => {
  const { posted, target } = recorder();
  vi.stubGlobal('parent', target);

  expect(isFramed()).toBe(true);

  const stop = reportEmbedHeight({
    getBoundingClientRect: () => ({ height: 64 }),
  });
  requestEmbedExpand();
  stop();

  expect(posted).toStrictEqual([
    { type: 'cheminfo:embed-height', height: 64 },
    { type: 'cheminfo:embed-expand' },
  ]);
});

test("by default a framed page hears its view on the page's own window", () => {
  const { posted, target } = recorder();
  const view = recorder();
  const listeners = new Set<(event: EmbedMessageEvent) => void>();
  vi.stubGlobal('parent', view.target);
  vi.stubGlobal(
    'addEventListener',
    (_type: string, listener: (event: EmbedMessageEvent) => void) => {
      listeners.add(listener);
    },
  );
  vi.stubGlobal(
    'removeEventListener',
    (_type: string, listener: (event: EmbedMessageEvent) => void) => {
      listeners.delete(listener);
    },
  );
  // A target of the card's own, which passes the heights on.
  const stop = reportEmbedHeight(
    { getBoundingClientRect: () => ({ height: 50 }) },
    { target },
  );
  for (const source of [view.target, target, {}]) {
    for (const listener of listeners) {
      listener({ source, data: { type: EMBED_MEASURE_MESSAGE } });
    }
  }
  stop();

  expect(posted).toStrictEqual([
    { type: 'cheminfo:embed-height', height: 50 },
    { type: 'cheminfo:embed-height', height: 50 },
    { type: 'cheminfo:embed-height', height: 50 },
  ]);
  expect(view.posted).toStrictEqual([]);
  expect(listeners.size).toBe(0);
});

test('a card asks its view for the full page', () => {
  const { posted, target } = recorder();

  requestEmbedExpand(target);

  expect(posted).toStrictEqual([{ type: EMBED_EXPAND_MESSAGE }]);
  expect(EMBED_EXPAND_MESSAGE).toBe('cheminfo:embed-expand');
});
