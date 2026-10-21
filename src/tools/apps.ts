import type {
  AppCsp,
  AppPermissions,
  AppResourceUi,
  ResourceListing,
} from '../contract/index.ts';
import { APP_MIME_TYPE } from '../contract/index.ts';

import { contentVersion } from './contentVersion.ts';

/**
 * What a host reads when a resource's page cannot be made.
 */
export const RESOURCE_FAILED =
  'The resource could not be read. Try again later.';

/**
 * An MCP App: the HTML page a host loads in a sandbox to draw the answers
 * of the tools whose `ui.resourceUri` names it.
 */
export interface AppResource {
  /**
   * Its address, e.g. `ui://scipeaks/eln`.
   */
  uri: string;
  /**
   * For people.
   */
  name: string;
  /**
   * For people: what it shows.
   * @default undefined
   */
  description?: string;
  /**
   * The page, or what makes it when it is read.
   */
  html: string | (() => string | Promise<string>);
  /**
   * The origins the page loads from and calls: none when omitted.
   * @default undefined
   */
  csp?: AppCsp;
  /**
   * The browser capabilities it asks for, e.g. `{ clipboardWrite: {} }`.
   * @default undefined
   */
  permissions?: AppPermissions;
  /**
   * Whether it asks the host for a border and a background.
   * @default undefined - the host decides
   */
  prefersBorder?: boolean;
  /**
   * A dedicated sandbox origin, in the host's own format.
   * @default undefined
   */
  domain?: string;
}

/**
 * The app resources of a server, or a function giving them for each
 * request (their address may follow the request's origin).
 */
export type AppResourceList<Request = never> =
  | readonly AppResource[]
  | ((
      request: Request,
    ) => readonly AppResource[] | Promise<readonly AppResource[]>);

/**
 * A resource read: its listing and its page.
 */
export interface ReadAppResource {
  listing: ResourceListing;
  html: string;
}

/**
 * An app resource's `_meta.ui`.
 * @param resource - The resource.
 * @returns Its CSP, permissions, origin and border, those it sets.
 */
export function appResourceUi(resource: AppResource): AppResourceUi {
  const ui: AppResourceUi = {};
  if (resource.csp !== undefined) ui.csp = resource.csp;
  if (resource.permissions !== undefined) {
    ui.permissions = resource.permissions;
  }
  if (resource.domain !== undefined) ui.domain = resource.domain;
  if (resource.prefersBorder !== undefined) {
    ui.prefersBorder = resource.prefersBorder;
  }
  return ui;
}

/**
 * Read an app resource: its page, and its listing, whose version follows
 * the page and its `_meta`.
 * @param resource - The resource.
 * @returns The listing and the page.
 */
export async function readAppResource(
  resource: AppResource,
): Promise<ReadAppResource> {
  const html =
    typeof resource.html === 'string' ? resource.html : await resource.html();
  const meta = { ui: appResourceUi(resource) };
  const listing: ResourceListing = {
    uri: resource.uri,
    name: resource.name,
    mimeType: APP_MIME_TYPE,
    version: await contentVersion(JSON.stringify({ html, meta })),
    _meta: meta,
  };
  if (resource.description !== undefined) {
    listing.description = resource.description;
  }
  return { listing, html };
}

/**
 * The app resources of this request.
 * @param resources - The list, or the function giving it.
 * @param request - The request.
 * @returns The resources.
 */
export async function appResourcesOf<Request>(
  resources: AppResourceList<Request> | undefined,
  request: Request,
): Promise<readonly AppResource[]> {
  if (resources === undefined) return [];
  return typeof resources === 'function' ? resources(request) : resources;
}

/**
 * Serve another server's app resource again, e.g. from a stdio bridge: as
 * that server lists it, its page read from that server whenever a host
 * reads it.
 * @param listing - The resource, as `GET resources` lists it.
 * @param readHtml - Reads its page from that server.
 * @returns The resource.
 */
export function forwardAppResource(
  listing: ResourceListing,
  readHtml: (uri: string) => Promise<string>,
): AppResource {
  const ui = listing._meta?.ui;
  const resource: AppResource = {
    uri: listing.uri,
    name: listing.name,
    html: () => readHtml(listing.uri),
  };
  if (listing.description !== undefined) {
    resource.description = listing.description;
  }
  if (ui?.csp !== undefined) resource.csp = ui.csp;
  if (ui?.permissions !== undefined) resource.permissions = ui.permissions;
  if (ui?.domain !== undefined) resource.domain = ui.domain;
  if (ui?.prefersBorder !== undefined) {
    resource.prefersBorder = ui.prefersBorder;
  }
  return resource;
}

/**
 * The resources a server serves: the first of each uri.
 * @param resources - The resources, as given.
 * @param onDuplicate - Told of each resource left out.
 * @returns The resources, each uri once, in their order.
 */
export function uniqueResources(
  resources: readonly AppResource[],
  onDuplicate?: (uri: string) => void,
): AppResource[] {
  const seen = new Set<string>();
  const unique: AppResource[] = [];
  for (const resource of resources) {
    if (seen.has(resource.uri)) {
      onDuplicate?.(resource.uri);
      continue;
    }
    seen.add(resource.uri);
    unique.push(resource);
  }
  return unique;
}
