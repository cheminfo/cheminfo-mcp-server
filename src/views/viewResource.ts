import type { AppPermissions } from '../contract/index.ts';
import type { AppResource } from '../tools/apps.ts';

import type { ViewBuild } from './viewBuild.ts';
import { VIEW_LOADER_FILE } from './viewLoader.ts';

/**
 * Options of {@link viewResource}.
 */
export interface ViewResourceOptions {
  /**
   * Where the server is reached, with its path: the assets are served under
   * it (see viewsBaseUrl()).
   */
  baseUrl: string;
  /**
   * The resource's address, e.g. `ui://scipeaks/eln`.
   */
  uri: string;
  /**
   * For people, and the page's title.
   */
  name: string;
  /**
   * For people: what the view shows.
   * @default undefined
   */
  description?: string;
  /**
   * The browser capabilities the view asks for, e.g. `{ clipboardWrite: {} }`.
   * @default undefined
   */
  permissions?: AppPermissions;
  /**
   * Whether the view asks the host for a border and a background.
   * @default undefined - the host decides
   */
  prefersBorder?: boolean;
  /**
   * Where registerViewAssets() serves the assets, under `baseUrl`: its
   * `prefix`, without the leading slash.
   * @default 'views/assets'
   */
  assetsPath?: string;
  /**
   * Load the build through registerViewAssets()'s `loader.js`, whose name
   * never changes, instead of naming its hashed files: the page then never
   * changes with the build, and a host that keeps it still loads the
   * current one after a deploy.
   * @default false
   */
  loader?: boolean;
}

/**
 * A host name (a final dot allowed), an IPv4 address or a bracketed IPv6
 * one, and a port.
 */
const HOST = /^(?:[\w-]+(?:\.[\w-]+)*\.?|\[[\d.:A-Fa-f]+\])(?::\d{1,5})?$/;
/**
 * A path of plain segments: nothing that could leave an HTML attribute.
 */
const PATH = /^\/(?:[\w.~%-]+\/)*$/;
/**
 * The assets' path: plain segments, no leading or trailing slash.
 */
const ASSETS_PATH = /^[\w~-][\w.~-]*(?:\/[\w~-][\w.~-]*)*$/;
const UNUSABLE_BASE =
  'The views are served from an address that is not a plain http or https URL.';

/**
 * The address a view's assets are served under: the server's public URL,
 * else the origin the request came to (development).
 * @param publicUrl - The public URL, with its trailing slash.
 * @param request - The request's protocol and host.
 * @param request.protocol - `http` or `https`.
 * @param request.host - The host, with its port.
 * @returns The base URL, with a trailing slash.
 */
export function viewsBaseUrl(
  publicUrl: string | undefined,
  request: { protocol: string; host: string },
): string {
  return publicUrl ?? `${request.protocol}://${request.host}/`;
}

/**
 * A view's app resource: a page that only loads the views build's hashed
 * entry module, its imports and its stylesheets from
 * `<baseUrl><assetsPath>/`, and the policy that lets it: that origin for
 * scripts and styles, no origin to call (every call goes through the host).
 * @param build - The views build, as readViewBuild() gives it.
 * @param options - Where it is served, and what the resource is.
 * @returns The resource.
 * @throws {Error} When the base URL is not a plain http(s) address, which a
 *   hostile Host header could otherwise make it, or the assets path is not
 *   a path of plain segments.
 */
export function viewResource(
  build: ViewBuild,
  options: ViewResourceOptions,
): AppResource {
  const base = checkBaseUrl(options.baseUrl);
  const assetsPath = options.assetsPath ?? 'views/assets';
  if (!ASSETS_PATH.test(assetsPath)) {
    throw new Error(
      `Not a path of plain segments: ${JSON.stringify(assetsPath)}.`,
    );
  }
  const { assets } = build;
  const url = (file: string) =>
    `${base.href}${assetsPath}/${file.slice('assets/'.length)}`;
  const loads =
    options.loader === true
      ? [
          `    <script type="module" crossorigin src="${url(`assets/${VIEW_LOADER_FILE}`)}"></script>`,
        ]
      : [
          ...assets.styles.map(
            (file) =>
              `    <link rel="stylesheet" crossorigin href="${url(file)}" />`,
          ),
          ...assets.preloads.map(
            (file) =>
              `    <link rel="modulepreload" crossorigin href="${url(file)}" />`,
          ),
          `    <script type="module" crossorigin src="${url(assets.script)}"></script>`,
        ];
  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '    <meta name="color-scheme" content="light dark" />',
    `    <title>${escapeText(options.name)}</title>`,
    ...loads,
    '  </head>',
    '  <body>',
    '    <div id="root"></div>',
    '  </body>',
    '</html>',
    '',
  ].join('\n');
  const resource: AppResource = {
    uri: options.uri,
    name: options.name,
    html,
    csp: { resourceDomains: [base.origin], connectDomains: [] },
  };
  if (options.description !== undefined) {
    resource.description = options.description;
  }
  if (options.permissions !== undefined) {
    resource.permissions = options.permissions;
  }
  if (options.prefersBorder !== undefined) {
    resource.prefersBorder = options.prefersBorder;
  }
  return resource;
}

/**
 * Check a base URL: http or https, a plain host, a path of plain segments,
 * no credentials, query or fragment. A request's host comes from a header,
 * so nothing in it may leave the HTML attributes it is written into.
 * @param baseUrl - The URL.
 * @returns Its origin, and its origin and path ending with a slash.
 * @throws {Error} When it is anything else.
 */
function checkBaseUrl(baseUrl: string): { origin: string; href: string } {
  const url = URL.parse(baseUrl);
  if (
    url === null ||
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    !HOST.test(url.host)
  ) {
    throw new Error(UNUSABLE_BASE);
  }
  const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  if (!PATH.test(path)) throw new Error(UNUSABLE_BASE);
  return { origin: url.origin, href: `${url.origin}${path}` };
}

/**
 * Text written between HTML tags.
 * @param text - The text.
 * @returns The text, its `&`, `<` and `>` escaped.
 */
function escapeText(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
