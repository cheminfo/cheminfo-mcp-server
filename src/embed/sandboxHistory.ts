/**
 * What {@link installSandboxHistory} wraps of the page's session history.
 */
export interface SandboxHistory {
  pushState: (data: unknown, unused: string, url?: string | URL | null) => void;
  replaceState: (
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) => void;
}

/**
 * How a page navigates: its `location`.
 */
export interface SandboxNavigation {
  assign: (url: string) => void;
  replace: (url: string) => void;
}

/**
 * What {@link installSandboxHistory} reads of the page's global scope:
 * `globalThis` in a page.
 */
export interface SandboxHistoryScope {
  /**
   * The page's origin, `'null'` in an opaque one.
   * @default undefined - not an opaque origin: the history is left as it is
   */
  origin?: string;
  /**
   * The page's session history, whose two methods are wrapped.
   * @default undefined - no history: nothing is installed
   */
  history?: SandboxHistory;
  /**
   * How the page navigates to an address its history refuses.
   * @default undefined - no way to navigate: nothing is installed
   */
  location?: SandboxNavigation;
}

const wrapped = new WeakSet<object>();

/**
 * Let a page framed by an `embedView` change its path in Safari. In an opaque
 * origin WebKit lets `history.pushState()` and `replaceState()` change only
 * the query and the fragment, and throws a `SecurityError` for another path
 * (Chromium and Firefox accept it): a router moving the page to its route at
 * start leaves it blank. In such a page, and only there, both methods are
 * wrapped: an address the browser refuses is navigated to instead, with
 * `location.assign()` for a push and `location.replace()` for a replace, so
 * the page loads again at that address (without the state it was given).
 *
 * Call it before the page's router starts (see `installEmbedPage`).
 * Anywhere else it does nothing.
 * @param scope - The page's global scope.
 */
export function installSandboxHistory(
  scope: SandboxHistoryScope = globalThis as SandboxHistoryScope,
): void {
  const { history, location } = scope;
  if (
    scope.origin !== 'null' ||
    history === undefined ||
    location === undefined ||
    wrapped.has(history)
  ) {
    return;
  }
  wrapped.add(history);
  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  history.pushState = (data, unused, url) => {
    changeOrNavigate(
      () => push(data, unused, url),
      url,
      (address) => location.assign(address),
    );
  };
  history.replaceState = (data, unused, url) => {
    changeOrNavigate(
      () => replace(data, unused, url),
      url,
      (address) => location.replace(address),
    );
  };
}

/**
 * Change the address in the history, or navigate to it when the browser
 * refuses it for security.
 * @param change - The history's own change.
 * @param url - The address it changes to.
 * @param navigate - Navigates to it.
 */
function changeOrNavigate(
  change: () => void,
  url: string | URL | null | undefined,
  navigate: (address: string) => void,
): void {
  try {
    change();
  } catch (error) {
    if (url === undefined || url === null || !isSecurityError(error)) {
      throw error;
    }
    navigate(String(url));
  }
}

/**
 * Whether the browser refused an address for security.
 * @param error - What a history method threw.
 * @returns True for a `SecurityError`.
 */
function isSecurityError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'SecurityError'
  );
}
