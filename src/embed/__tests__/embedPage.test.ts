import { expect, test } from 'vitest';

import type {
  EmbedKeyEvent,
  EmbedPageScope,
  EmbedTarget,
  SandboxHistory,
} from '../index.ts';
import { installEmbedPage } from '../index.ts';

class FakeWorker {
  readonly url: string;

  constructor(url: string | URL) {
    this.url = String(url);
  }
}

interface PageOptions {
  origin: string;
  isFramed: boolean;
}

/**
 * A page's global scope, framed or not.
 * @param options - Its origin, and whether a view frames it.
 * @returns The scope, what it posts to its parent, and how to press a key.
 */
function page(options: PageOptions) {
  const posted: unknown[] = [];
  const keyListeners: Array<{
    listener: (event: EmbedKeyEvent) => void;
    capture: boolean;
  }> = [];
  const dialog = { isOpen: false };
  const history: SandboxHistory = {
    pushState: () => undefined,
    replaceState: () => undefined,
  };
  const scope: EmbedPageScope = {
    origin: options.origin,
    location: {
      href: 'https://3d.example/',
      assign: () => undefined,
      replace: () => undefined,
    },
    document: {
      baseURI: 'https://3d.example/',
      querySelector: (selectors) =>
        dialog.isOpen && selectors === '[aria-modal="true"]' ? {} : null,
    },
    Worker: FakeWorker,
    history,
    addEventListener: (_type, listener, { capture }) => {
      keyListeners.push({ listener, capture });
    },
  };
  if (options.isFramed) {
    scope.parent = {
      postMessage: (message) => {
        posted.push(message);
      },
    };
  }
  /**
   * Press a key: every listener of the page sees it, then one may prevent it.
   * @param key - The key.
   * @param event - How it is pressed, and whether the page prevents it.
   * @param event.isComposing - Whether an input method is composing.
   * @param event.isPrevented - Whether a later listener prevents it.
   */
  const press = (
    key: string,
    { isComposing = false, isPrevented = false } = {},
  ) => {
    const keyEvent: EmbedKeyEvent = {
      key,
      isComposing,
      defaultPrevented: false,
    };
    for (const { listener } of keyListeners) listener(keyEvent);
    keyEvent.defaultPrevented = isPrevented;
  };
  return { scope, history, posted, keyListeners, dialog, press };
}

async function afterKeys() {
  await new Promise((resolve) => {
    setTimeout(resolve, 5);
  });
}

test('a framed page in an opaque origin gets its workers, its history and Escape', async () => {
  const framed = page({ origin: 'null', isFramed: true });
  const { pushState } = framed.history;
  installEmbedPage(framed.scope);
  installEmbedPage(framed.scope);

  expect(framed.scope.Worker).not.toBe(FakeWorker);
  expect(framed.history.pushState).not.toBe(pushState);
  expect(framed.keyListeners.map(({ capture }) => capture)).toStrictEqual([
    true,
  ]);

  framed.press('Escape');
  framed.press('Escape', { isPrevented: true });
  framed.press('Escape', { isComposing: true });
  framed.press('Enter');
  framed.dialog.isOpen = true;
  framed.press('Escape');
  await afterKeys();

  expect(framed.posted).toStrictEqual([{ type: 'cheminfo:embed-collapse' }]);
});

test('a framed page with its own origin forwards only Escape', async () => {
  const framed = page({ origin: 'https://3d.example', isFramed: true });
  const { pushState } = framed.history;
  installEmbedPage(framed.scope);
  framed.press('Escape');
  await afterKeys();

  expect(framed.scope.Worker).toBe(FakeWorker);
  expect(framed.history.pushState).toBe(pushState);
  expect(framed.posted).toStrictEqual([{ type: 'cheminfo:embed-collapse' }]);
});

test('a page that is not framed is left as it is', () => {
  const alone = page({ origin: 'null', isFramed: false });
  installEmbedPage(alone.scope);
  const top = page({ origin: 'null', isFramed: false });
  top.scope.parent = top.scope as unknown as EmbedTarget;
  installEmbedPage(top.scope);

  for (const { scope, keyListeners } of [alone, top]) {
    expect(scope.Worker).toBe(FakeWorker);
    expect(keyListeners).toHaveLength(0);
  }
});
