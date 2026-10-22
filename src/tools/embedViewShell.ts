import {
  EMBED_COLLAPSE_MESSAGE,
  EMBED_EXPAND_MESSAGE,
  EMBED_HEIGHT_MESSAGE,
  EMBED_MEASURE_MESSAGE,
} from '../embed/embedMessages.ts';

import { embedViewScript } from './embedViewScript.ts';

/**
 * The `_meta` key of an answer whose view frames a page: `{ url, page? }`.
 */
export const EMBED_META_KEY = 'org.cheminfo/embed';

/**
 * What the framed pages may use of what the host grants the view: the full
 * screen, and writing to the clipboard. For any origin, as a page in a
 * sandboxed view has an opaque one, which no other allowlist matches.
 */
const FRAME_ALLOW = 'fullscreen *; clipboard-write *';

/**
 * The heights a page may report, in pixels.
 */
const MIN_HEIGHT = 40;
const MAX_HEIGHT = 4000;

/**
 * The frame's height while the page loads, until it reports its own.
 */
const LOADING_HEIGHT = 120;

/**
 * How long a page has to report its height before it counts as not loaded.
 */
const REPORT_WAIT_MS = 8000;

/**
 * The height of the line a card that did not load is folded to.
 */
const STALLED_HEIGHT = 44;

/**
 * The shell page of an `embedView`: an MCP App (protocol 2026-01-26) that
 * frames the page an answer names. Inline it frames `url`, the answer's card,
 * as tall as the card reports and never taller than the host allows (or as
 * tall as the host fixes), so nothing scrolls twice; over the full screen it
 * frames `page`, the full page, kept once loaded. Both frames pass on the full
 * screen and the clipboard the host grants. Right after a click, a card asks
 * for the full page with a `cheminfo:embed-expand` message: the shell asks the
 * host for the full screen, or opens the site's own page where the host has
 * none. A `cheminfo:embed-collapse` message (Escape) leaves the full screen.
 * @param name - What the frame is called, for a screen reader.
 * @param origins - The origins it may frame.
 * @param height - The frame's height when the page never reports its own;
 *   undefined folds such a card to a line linking to its page.
 * @returns The page.
 */
export function embedViewHtml(
  name: string,
  origins: readonly string[],
  height?: number,
): string {
  const settings = JSON.stringify({
    name,
    origins,
    height: height ?? null,
    stalledHeight: STALLED_HEIGHT,
    key: EMBED_META_KEY,
    allow: FRAME_ALLOW,
    heightMessage: EMBED_HEIGHT_MESSAGE,
    expandMessage: EMBED_EXPAND_MESSAGE,
    measureMessage: EMBED_MEASURE_MESSAGE,
    collapseMessage: EMBED_COLLAPSE_MESSAGE,
    minHeight: MIN_HEIGHT,
    maxHeight: MAX_HEIGHT,
    loadingHeight: LOADING_HEIGHT,
    reportWaitMs: REPORT_WAIT_MS,
  })
    // No value can close the script it is written into.
    .split('<')
    .join(String.raw`\u003c`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(name)}</title>
<style>
html, body { margin: 0; padding: 0; overflow: hidden; background: transparent; }
iframe { display: block; width: 100%; border: 0; }
iframe[hidden] { display: none; }
p { margin: 12px; color: #5b6875; font: 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
button { padding: 0; border: 0; background: none; color: #16202c; font: inherit; text-decoration: underline; cursor: pointer; }
</style>
</head>
<body>
<p id="status">Loading…</p>
<p id="note" hidden>The card did not load. <button id="open" type="button">Open the page</button></p>
<iframe id="card" title="${escapeText(name)}" allow="${FRAME_ALLOW}" hidden></iframe>
<script>
${embedViewScript(settings)}
</script>
</body>
</html>
`;
}

function escapeText(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
