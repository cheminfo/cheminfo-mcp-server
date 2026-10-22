/**
 * The message a framed page posts to its `embedView` with the height of its
 * content, in CSS pixels: `{ type, height }`.
 */
export const EMBED_HEIGHT_MESSAGE = 'cheminfo:embed-height';

/**
 * The message a framed page posts to its `embedView` to show the full page
 * rather than its card: `{ type }`. The view acts on it only right after a
 * click in the card: it asks the host for the full screen, and opens the
 * site's own page only when the host has no full screen to give.
 */
export const EMBED_EXPAND_MESSAGE = 'cheminfo:embed-expand';

/**
 * The message an `embedView` posts to its card when it shows the card again
 * after the full page: `{ type }`. The card answers with its height, even
 * unchanged, since what it measured while hidden may not be what it is.
 */
export const EMBED_MEASURE_MESSAGE = 'cheminfo:embed-measure';

/**
 * The message a framed page posts to its `embedView` when the user presses
 * Escape and the page has no use for it: `{ type }`. Over the full screen,
 * the view asks the host to show it inline again.
 */
export const EMBED_COLLAPSE_MESSAGE = 'cheminfo:embed-collapse';
