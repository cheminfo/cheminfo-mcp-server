import { runInNewContext } from 'node:vm';

import { embedView } from '../embedView.ts';

export const CARD = 'https://site.example/ph?acid=HCl&embed=1&card=1';
export const PAGE = 'https://site.example/ph?acid=HCl&embed=1';
export const MODES = ['inline', 'fullscreen'];
export const INLINE = { width: 958, maxHeight: 500 };
export const FULL = { width: 1600, height: 900 };

/**
 * A window as the shell sees it in a frame: where it posts.
 */
export interface FakeWindow {
  posted: unknown[];
  postMessage: (message: unknown, targetOrigin: string) => void;
}

/**
 * A frame of the shell's document.
 */
export interface FakeFrame {
  hidden: boolean;
  title: string;
  style: { height?: string };
  contentWindow: FakeWindow;
  attributes: Map<string, string>;
  isRemoved: boolean;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  remove: () => void;
}

/**
 * A JSON-RPC message the shell posts to its host.
 */
export interface Message {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
}

/**
 * A window that keeps what is posted to it, cloned as a browser clones it,
 * out of the script's realm.
 * @returns The window.
 */
export function fakeWindow(): FakeWindow {
  const posted: unknown[] = [];
  return {
    posted,
    postMessage: (message) => {
      posted.push(structuredClone(message));
    },
  };
}

function fakeFrame(isHidden: boolean): FakeFrame {
  const attributes = new Map<string, string>();
  const frame: FakeFrame = {
    hidden: isHidden,
    title: '',
    style: {},
    contentWindow: fakeWindow(),
    attributes,
    isRemoved: false,
    setAttribute: (name, value) => {
      attributes.set(name, value);
    },
    getAttribute: (name) => attributes.get(name) ?? null,
    remove: () => {
      frame.isRemoved = true;
    },
  };
  return frame;
}

/**
 * Run the view's script against stand-ins of its document, its host, its
 * timers and the user's activation.
 * @param origins - The origins the view frames.
 * @returns The stand-ins, and functions to speak for the host and the frames.
 */
export function startShell(origins: string[] = ['https://site.example']) {
  const html = embedView({
    uri: 'ui://site/page',
    name: 'site.example',
    origins,
  }).html as string;
  const script =
    /<script>(?<code>[\s\S]*)<\/script>/.exec(html)?.groups?.code ?? '';
  const sent: Message[] = [];
  const listeners: Array<(event: { source: unknown; data: unknown }) => void> =
    [];
  const timers: Array<() => void> = [];
  const status = { hidden: false, textContent: 'Loading…' };
  const card = fakeFrame(true);
  const appended: FakeFrame[] = [];
  const activation = { isActive: false };
  const parent = {
    postMessage: (message: Message) => {
      sent.push(structuredClone(message));
    },
  };
  const window = {
    parent,
    addEventListener: (
      _type: string,
      listener: (event: { source: unknown; data: unknown }) => void,
    ) => {
      listeners.push(listener);
    },
  };
  const document = {
    getElementById: (id: string) => (id === 'card' ? card : status),
    createElement: () => fakeFrame(false),
    body: {
      append: (frame: FakeFrame) => {
        appended.push(frame);
      },
    },
  };
  runInNewContext(script, {
    window,
    document,
    navigator: { userActivation: activation },
    URL,
    setTimeout: (callback: () => void) => {
      timers.push(callback);
    },
    clearTimeout: () => undefined,
  });
  const dispatch = (source: unknown, data: unknown) => {
    for (const listener of listeners) listener({ source, data });
  };
  const fromHost = (data: Record<string, unknown>) =>
    dispatch(parent, { jsonrpc: '2.0', ...data });
  return {
    sent,
    status,
    card,
    appended,
    timers,
    activation,
    fromHost,
    fromCard: (data: unknown) => dispatch(card.contentWindow, data),
    fromWindow: dispatch,
    /**
     * Answer `ui/initialize`.
     * @param hostContext - The host's context.
     */
    start: async (hostContext: Record<string, unknown>) => {
      fromHost({ id: 1, result: { hostContext } });
      await settle();
    },
    answer: (meta: Record<string, unknown>) =>
      fromHost({
        method: 'ui/notifications/tool-result',
        params: { _meta: meta },
      }),
    changeContext: (context: Record<string, unknown>) =>
      fromHost({
        method: 'ui/notifications/host-context-changed',
        params: context,
      }),
  };
}

/**
 * Let the shell's promises settle.
 */
export async function settle() {
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * The heights the shell asked its host for.
 * @param sent - What the shell posted to its host.
 * @returns The heights, in order.
 */
export function sizes(sent: Message[]) {
  return sent
    .filter((message) => message.method === 'ui/notifications/size-changed')
    .map((message) => message.params?.height);
}

/**
 * The methods of what the shell posted to its host: its requests and its
 * notifications, without its answers.
 * @param sent - What the shell posted to its host.
 * @returns The methods, in order.
 */
export function methods(sent: Message[]) {
  return sent
    .map((message) => message.method)
    .filter((method) => method !== undefined);
}
