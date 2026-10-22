/**
 * The script of an `embedView` shell (see `embedViewHtml`): an MCP App
 * (protocol 2026-01-26) that frames an answer's card inline and its full page
 * over the full screen.
 *
 * - A frame loads exactly the address it checked: an http(s) one of the
 *   view's origins, as the browser reads it.
 * - Inline, the card frame is as tall as the card reports (from a hidden
 *   card, a height above 0), within the host's `maxHeight`, or exactly the
 *   height the host fixes. A card that never reports gets the default after
 *   `reportWaitMs`. Shown again after the full page, the card is asked to
 *   measure itself.
 * - A card's request for the full page counts only right after a click in
 *   it: the view asks the host for the full screen, stays inline when it is
 *   refused, and opens the site's page only when the host has no full screen,
 *   or when the full screen already shows the card.
 * - An Escape the card or the page forwards leaves the full screen.
 * @param settings - The settings, as JSON that cannot close the script.
 * @returns The script.
 */
export function embedViewScript(settings: string): string {
  return `(() => {
  const settings = ${settings};
  const status = document.getElementById('status');
  const card = document.getElementById('card');
  const context = { displayMode: 'inline', availableDisplayModes: [], containerDimensions: {} };
  const pending = new Map();
  let nextId = 1;
  let shown = null;
  let pageFrame = null;
  let covered = false;
  let wanted = settings.loadingHeight;
  let heard = false;
  let waiting;
  let posted = -1;
  const post = (message) =>
    window.parent.postMessage({ jsonrpc: '2.0', ...message }, '*');
  const request = (method, params) => {
    const id = nextId++;
    post({ id, method, params });
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  const allowed = (url) => {
    if (typeof url !== 'string') return null;
    try {
      const parsed = new URL(url);
      const web = parsed.protocol === 'https:' || parsed.protocol === 'http:';
      return web && settings.origins.includes(parsed.origin) ? parsed.href : null;
    } catch {
      return null;
    }
  };
  const merge = (next) => {
    if (!next || typeof next !== 'object') return;
    for (const key of ['displayMode', 'availableDisplayModes', 'containerDimensions']) {
      if (next[key] !== undefined) context[key] = next[key];
    }
  };
  const fullscreen = () => context.displayMode === 'fullscreen';
  const fullscreenOffered = () =>
    Array.isArray(context.availableDisplayModes) &&
    context.availableDisplayModes.includes('fullscreen');
  const layout = () => {
    if (!shown) return;
    const box = context.containerDimensions || {};
    const showPage = fullscreen() && shown.page !== null;
    if (showPage && !pageFrame) {
      pageFrame = document.createElement('iframe');
      pageFrame.title = settings.name;
      pageFrame.setAttribute('allow', settings.allow);
      pageFrame.setAttribute('src', shown.page);
      document.body.append(pageFrame);
    }
    card.hidden = showPage;
    if (pageFrame) pageFrame.hidden = !showPage;
    if (showPage) {
      covered = true;
    } else if (covered) {
      covered = false;
      // Hidden, the card may have changed unseen: it measures itself again.
      card.contentWindow?.postMessage({ type: settings.measureMessage }, '*');
    }
    if (fullscreen()) {
      const frame = showPage ? pageFrame : card;
      frame.style.height = Number.isFinite(box.height) ? box.height + 'px' : '100vh';
      return;
    }
    const fixed = Number.isFinite(box.height) && box.height > 0;
    const limit = Number.isFinite(box.maxHeight) && box.maxHeight > 0 ? box.maxHeight : Infinity;
    const height = fixed ? box.height : Math.min(wanted, limit);
    card.style.height = height + 'px';
    if (height === posted) return;
    posted = height;
    post({ method: 'ui/notifications/size-changed', params: { height } });
  };
  const siteAddress = () => {
    const url = new URL(shown.page || shown.url);
    const kept = url.search
      .slice(1)
      .split('&')
      .filter((pair) => pair !== '' && !['embed', 'card', 'hide'].includes(pair.split('=')[0]));
    url.search = kept.length === 0 ? '' : '?' + kept.join('&');
    return url.href;
  };
  const openSite = () => {
    request('ui/open-link', { url: siteAddress() }).catch(() => undefined);
  };
  const expand = () => {
    if (!shown) return;
    if (!fullscreenOffered() || (fullscreen() && shown.page === null)) {
      openSite();
      return;
    }
    if (fullscreen()) return;
    request('ui/request-display-mode', { mode: 'fullscreen' }).then(
      (result) => {
        // Refused, the card stays inline: the host's own control remains.
        if (!result || result.mode !== 'fullscreen') return;
        context.displayMode = 'fullscreen';
        layout();
      },
      () => undefined,
    );
  };
  const collapse = () => {
    if (!fullscreen()) return;
    request('ui/request-display-mode', { mode: 'inline' }).catch(() => undefined);
  };
  const show = (result) => {
    const embed = result && result._meta && result._meta[settings.key];
    const url = embed ? allowed(embed.url) : null;
    if (url === null) {
      shown = null;
      card.hidden = true;
      if (pageFrame) pageFrame.hidden = true;
      status.hidden = false;
      status.textContent = 'This answer has no page to show.';
      return;
    }
    const page = allowed(embed.page);
    if (pageFrame && pageFrame.getAttribute('src') !== page) {
      pageFrame.remove();
      pageFrame = null;
    }
    status.hidden = true;
    if (!shown || shown.url !== url) {
      card.setAttribute('src', url);
      heard = false;
      wanted = settings.loadingHeight;
      clearTimeout(waiting);
      waiting = setTimeout(() => {
        if (heard) return;
        wanted = settings.height;
        layout();
      }, settings.reportWaitMs);
    }
    shown = { url, page };
    layout();
  };
  const fromCard = (data) => {
    if (data.type === settings.heightMessage && Number.isFinite(data.height)) {
      // A hidden card not laid out measures 0 (Chromium); one that is laid
      // out (WebKit) measures its height.
      if (card.hidden && !(data.height > 0)) return;
      heard = true;
      wanted = Math.min(Math.max(Math.ceil(data.height), settings.minHeight), settings.maxHeight);
      layout();
    } else if (data.type === settings.expandMessage) {
      // Only right after a click in the card, whose activation the view shares.
      if (navigator.userActivation?.isActive === true) expand();
    } else if (data.type === settings.collapseMessage) {
      collapse();
    }
  };
  window.addEventListener('message', (event) => {
    const data = event.data;
    const fromPage = pageFrame !== null && event.source === pageFrame.contentWindow;
    if (event.source === card.contentWindow || fromPage) {
      if (!data || typeof data.type !== 'string') return;
      if (!fromPage) fromCard(data);
      else if (data.type === settings.collapseMessage) collapse();
      return;
    }
    if (event.source !== window.parent || !data || data.jsonrpc !== '2.0') return;
    if (data.method === undefined) {
      const waitingFor = pending.get(data.id);
      if (!waitingFor) return;
      pending.delete(data.id);
      if (data.error) waitingFor.reject(data.error);
      else waitingFor.resolve(data.result);
      return;
    }
    if (data.method === 'ui/notifications/tool-result') {
      show(data.params);
    } else if (data.method === 'ui/notifications/host-context-changed') {
      merge(data.params);
      layout();
    } else if (data.method === 'ui/notifications/tool-cancelled') {
      status.hidden = false;
      status.textContent = 'The call was cancelled.';
    } else if (data.id !== undefined) {
      post({ id: data.id, result: {} });
    }
  });
  request('ui/initialize', {
    protocolVersion: '2026-01-26',
    appInfo: { name: settings.name, version: '1.0.0' },
    appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
  }).then(
    (result) => {
      merge(result && result.hostContext);
      post({ method: 'ui/notifications/initialized', params: {} });
    },
    () => {
      status.textContent = 'The host did not answer.';
    },
  );
})();`;
}
