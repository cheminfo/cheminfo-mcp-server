import type { EmbedTarget } from './embedHelpers.ts';
import { requestEmbedExpand } from './embedHelpers.ts';

/**
 * Where {@link openSitePage} showed the page.
 */
export type SitePageOpening = 'window' | 'full-screen' | 'here';

/**
 * A window {@link openSitePage} opened.
 */
export interface OpenedWindow {
  opener: unknown;
}

/**
 * What {@link openSitePage} reads of the page's global scope.
 */
export interface SitePageScope {
  /**
   * The window framing the page.
   * @default undefined - the page is not framed
   */
  parent?: EmbedTarget;
  /**
   * `window.open`.
   * @default undefined - no window can be opened
   */
  open?: (url: string, target: string) => OpenedWindow | null;
  /**
   * The page's own address, to navigate when it is not framed.
   * @default undefined - nothing to navigate
   */
  location?: { assign: (url: string) => void };
}

/**
 * Show the site's own page that a card summarises: framed by a chat, in a
 * new window, so the conversation stays where it was; else in place. When the
 * host refuses the window (its frames allow no popup), the view is asked for
 * the full page over the full screen instead. The window is opened without
 * `noopener`, which would make `open` return null even when it worked, and its
 * `opener` is cleared at once. Call it from a click.
 * @param url - The site's page: the card's address without its card,
 *   `embed` and `hide` parameters.
 * @param scope - The page's global scope.
 * @returns Where the page was shown.
 */
export function openSitePage(
  url: string,
  scope: SitePageScope = globalThis as SitePageScope,
): SitePageOpening {
  const { parent } = scope;
  if (parent === undefined || (parent as unknown) === scope) {
    scope.location?.assign(url);
    return 'here';
  }
  const opened = scope.open?.(url, '_blank') ?? null;
  if (opened !== null) {
    opened.opener = null;
    return 'window';
  }
  requestEmbedExpand(parent);
  return 'full-screen';
}
