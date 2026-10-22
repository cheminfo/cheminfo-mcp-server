import type { AppResource } from './apps.ts';
import { EMBED_META_KEY, embedViewHtml } from './embedViewShell.ts';

export { EMBED_META_KEY, embedViewHtml } from './embedViewShell.ts';

/**
 * The height of the frame of a page that never reports its own, in pixels.
 */
const DEFAULT_HEIGHT = 640;

/**
 * Options of {@link embedView}.
 */
export interface EmbedViewOptions {
  /**
   * Its address, which the tools name in `ui.resourceUri`, e.g.
   * `ui://equilibrium/page`.
   */
  uri: string;
  /**
   * For people, e.g. `equilibrium.cheminfo.org`.
   */
  name: string;
  /**
   * The origins whose pages it may frame, e.g.
   * `['https://equilibrium.cheminfo.org']`: the host lets the view frame
   * these and nothing else.
   */
  origins: readonly string[];
  /**
   * For people: what it shows.
   * @default undefined
   */
  description?: string;
  /**
   * The height of the frame, in pixels, when the page never reports its own
   * with a `cheminfo:embed-height` message (see `cheminfo-mcp-server/embed`).
   * @default 640
   */
  height?: number;
}

/**
 * Options of {@link embedMeta}.
 */
export interface EmbedMetaOptions {
  /**
   * The full page, shown over the full screen when the user asks for more
   * than the card: usually the same page without its card, under `embed=1`.
   * @default undefined - the card is shown over the full screen too
   */
  page?: string;
}

/**
 * An MCP App that shows a site's own page: the view frames the address an
 * answer carries in `_meta` (see {@link embedMeta}), so the tool's answer is
 * drawn by the page that computes it in a browser, under `?embed=1`, rather
 * than by a second copy of it.
 *
 * Inline, it frames the answer's card: a small page drawing only what the
 * question asked, which reports its height (`reportEmbedHeight` of
 * `cheminfo-mcp-server/embed`) so the frame fits it, never taller than the
 * host allows. Over the full screen, it frames the full page. It asks the
 * host for the clipboard, and passes it on with the full screen to both
 * frames, so a page's own copy and full-screen buttons work in a chat.
 * @param options - Its address, its name and the origins it frames.
 * @returns The resource, for `createToolRoutes({ resources })`.
 */
export function embedView(options: EmbedViewOptions): AppResource {
  const { uri, name, origins, description, height = DEFAULT_HEIGHT } = options;
  return {
    uri,
    name,
    ...(description !== undefined && { description }),
    html: embedViewHtml(name, origins, height),
    csp: { frameDomains: [...origins] },
    permissions: { clipboardWrite: {} },
    prefersBorder: true,
  };
}

/**
 * What an answer carries for an {@link embedView} to show a page.
 * @param url - The card: the page drawing the answer compactly, under one of
 *   the view's origins, usually with `embed=1&card=1`.
 * @param options - The full page, shown when the user asks for more.
 * @returns The answer's `meta`.
 */
export function embedMeta(
  url: string,
  options: EmbedMetaOptions = {},
): Record<string, unknown> {
  const { page } = options;
  return { [EMBED_META_KEY]: page === undefined ? { url } : { url, page } };
}
