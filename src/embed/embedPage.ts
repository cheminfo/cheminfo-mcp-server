import type { EmbedTarget } from './embedHelpers.ts';
import { EMBED_COLLAPSE_MESSAGE } from './embedMessages.ts';
import type { SandboxHistoryScope } from './sandboxHistory.ts';
import { installSandboxHistory } from './sandboxHistory.ts';
import type { SandboxScope } from './sandboxWorkers.ts';
import { installSandboxWorkers } from './sandboxWorkers.ts';

/**
 * What the Escape forwarding reads of a `keydown` event.
 */
export interface EmbedKeyEvent {
  key: string;
  isComposing: boolean;
  defaultPrevented: boolean;
}

/**
 * What {@link installEmbedPage} reads of the page's global scope beside what
 * the workers and the history need: `globalThis` in a page.
 */
export interface EmbedKeysScope {
  /**
   * The window framing the page.
   * @default undefined - a top-level page: nothing is installed
   */
  parent?: EmbedTarget;
  /**
   * Listens to the page's keys.
   * @default undefined - Escape is not forwarded
   */
  addEventListener?: (
    type: 'keydown',
    listener: (event: EmbedKeyEvent) => void,
    options: { capture: boolean },
  ) => void;
  /**
   * The page's document, where an open dialog is looked for.
   * @default undefined - no dialog is ever open
   */
  document?: { querySelector: (selectors: string) => unknown };
}

/**
 * What {@link installEmbedPage} reads of the page's global scope.
 */
export type EmbedPageScope = SandboxScope &
  SandboxHistoryScope &
  EmbedKeysScope;

/**
 * An open dialog of the page, which takes the Escape key for itself.
 */
const OPEN_DIALOG = '[aria-modal="true"]';

const forwarding = new WeakSet<object>();

/**
 * Prepare a page an `embedView` frames: the one call a site makes for its
 * card and its full page. In a frame, it installs what the chat's sandbox
 * requires, only in an opaque origin: workers started from a bootstrap
 * (`installSandboxWorkers`), and a path change Safari refuses made by
 * navigation (`installSandboxHistory`). It also forwards Escape to the view,
 * which leaves the full screen: an Escape the page prevented, or pressed while
 * one of its dialogs (`[aria-modal="true"]`) is open, stays the page's own.
 *
 * Run it before any module that makes a worker or changes the address is
 * evaluated. A module's static imports are evaluated before its first
 * statement, so call it in a module of its own that the entry imports first,
 * or import the app dynamically after calling it. Anywhere else it does
 * nothing.
 * @param scope - The page's global scope.
 */
export function installEmbedPage(
  scope: EmbedPageScope = globalThis as EmbedPageScope,
): void {
  const { parent } = scope;
  if (parent === undefined || (parent as unknown) === scope) return;
  installSandboxWorkers(scope);
  installSandboxHistory(scope);
  forwardEscape(scope, parent);
}

/**
 * Post `cheminfo:embed-collapse` to the view on an Escape the page leaves
 * unused.
 * @param scope - The page's global scope.
 * @param parent - The view framing the page.
 */
function forwardEscape(scope: EmbedPageScope, parent: EmbedTarget): void {
  if (scope.addEventListener === undefined || forwarding.has(scope)) return;
  forwarding.add(scope);
  scope.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      const dialog = scope.document?.querySelector(OPEN_DIALOG);
      if (dialog !== null && dialog !== undefined) return;
      // Read once every listener of the page has seen the key.
      setTimeout(() => {
        if (event.defaultPrevented) return;
        parent.postMessage({ type: EMBED_COLLAPSE_MESSAGE }, '*');
      }, 0);
    },
    { capture: true },
  );
}
