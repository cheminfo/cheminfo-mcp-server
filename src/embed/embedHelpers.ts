import {
  EMBED_EXPAND_MESSAGE,
  EMBED_HEIGHT_MESSAGE,
  EMBED_MEASURE_MESSAGE,
} from './embedMessages.ts';

/**
 * What the height report reads of an element: its rendered box.
 */
export interface MeasuredElement {
  getBoundingClientRect: () => { height: number };
}

/**
 * The window a framed page posts to: its parent.
 */
export interface EmbedTarget {
  postMessage: (message: unknown, targetOrigin: string) => void;
}

/**
 * What the height report needs of a `ResizeObserver`.
 */
export interface SizeObserver {
  observe: (target: MeasuredElement) => void;
  disconnect: () => void;
}

/**
 * A `ResizeObserver` constructor, or a stand-in for one.
 */
export type SizeObserverConstructor = new (
  callback: () => void,
) => SizeObserver;

/**
 * What the height report reads of a `message` event.
 */
export interface EmbedMessageEvent {
  source: unknown;
  data: unknown;
}

/**
 * The window whose `message` events the height report listens to.
 */
export interface EmbedMessageSource {
  addEventListener: (
    type: 'message',
    listener: (event: EmbedMessageEvent) => void,
  ) => void;
  removeEventListener: (
    type: 'message',
    listener: (event: EmbedMessageEvent) => void,
  ) => void;
}

/**
 * Options of {@link reportEmbedHeight}.
 */
export interface ReportEmbedHeightOptions {
  /**
   * The window the height is posted to.
   * @default the page's parent, when the page is framed
   */
  target?: EmbedTarget;
  /**
   * The observer that tells when the element changes size.
   * @default globalThis.ResizeObserver
   */
  ResizeObserver?: SizeObserverConstructor;
  /**
   * The window whose `message` events carry the view's requests to measure
   * again (`cheminfo:embed-measure`), answered when they come from `target`
   * or from the page's parent.
   * @default globalThis, the page's window
   */
  messages?: EmbedMessageSource;
}

/**
 * Tell the `embedView` framing this page how tall its content is, now and on
 * every change of the element's size, so the view's frame fits the content
 * and never scrolls a second time. Measure the element holding all of the
 * card: the document must add no height of its own around it (no margin on
 * `body`, no `min-height: 100vh`). When the view shows the card again after
 * the full page, it asks for the height, which is then posted even if
 * unchanged.
 * @param element - The element holding the page's content: none (a React ref
 *   not attached yet) reports nothing.
 * @param options - Where to post, the observer and the window listened to.
 * @returns A function that stops the reports.
 */
export function reportEmbedHeight(
  element: MeasuredElement | null | undefined,
  options: ReportEmbedHeightOptions = {},
): () => void {
  if (element === null || element === undefined) return () => undefined;
  const target = options.target ?? frameParent();
  if (target === undefined) return () => undefined;
  let last = -1;
  const report = (isAsked: boolean) => {
    const height = Math.ceil(element.getBoundingClientRect().height);
    if (height === last && !isAsked) return;
    last = height;
    target.postMessage({ type: EMBED_HEIGHT_MESSAGE, height }, '*');
  };
  report(false);
  const parent = frameParent();
  const messages = options.messages ?? globalMessageSource();
  const onMessage = (event: EmbedMessageEvent) => {
    const { source, data } = event;
    const isFromView =
      source === target || (parent !== undefined && source === parent);
    if (isFromView && isMeasureRequest(data)) report(true);
  };
  messages?.addEventListener('message', onMessage);
  const Observer = options.ResizeObserver ?? globalResizeObserver();
  const observer =
    Observer === undefined ? undefined : new Observer(() => report(false));
  observer?.observe(element);
  return () => {
    observer?.disconnect();
    messages?.removeEventListener('message', onMessage);
  };
}

/**
 * Whether this page is framed: a card shown by an `embedView`, rather than a
 * page opened on its own.
 * @returns True in a frame.
 */
export function isFramed(): boolean {
  return frameParent() !== undefined;
}

/**
 * Ask the `embedView` framing this page to show the full page: the full
 * screen when the host offers one, else the site's page in a new tab, once
 * the user agrees. Call it from a click: the view acts only on a request that
 * follows one, as a host grants the full screen only right after a click. A
 * page that is not framed posts nothing (see {@link isFramed}), and navigates
 * to its full page itself.
 * @param target - The window the request is posted to.
 */
export function requestEmbedExpand(
  target: EmbedTarget | undefined = frameParent(),
): void {
  target?.postMessage({ type: EMBED_EXPAND_MESSAGE }, '*');
}

/**
 * The window framing this page.
 * @returns The parent of a framed page, undefined in a top-level window.
 */
function frameParent(): EmbedTarget | undefined {
  const { parent } = globalThis as { parent?: EmbedTarget };
  return parent === undefined || (parent as unknown) === globalThis
    ? undefined
    : parent;
}

/**
 * Whether a message is the view's request to measure again.
 * @param data - The message's data.
 * @returns True for `cheminfo:embed-measure`.
 */
function isMeasureRequest(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === EMBED_MEASURE_MESSAGE
  );
}

/**
 * The environment's window, as a source of `message` events.
 * @returns It, when the environment has one.
 */
function globalMessageSource(): EmbedMessageSource | undefined {
  const scope = globalThis as Partial<EmbedMessageSource>;
  return typeof scope.addEventListener === 'function' &&
    typeof scope.removeEventListener === 'function'
    ? (scope as EmbedMessageSource)
    : undefined;
}

/**
 * The environment's `ResizeObserver`.
 * @returns It, when the environment has one.
 */
function globalResizeObserver(): SizeObserverConstructor | undefined {
  return (globalThis as { ResizeObserver?: SizeObserverConstructor })
    .ResizeObserver;
}
