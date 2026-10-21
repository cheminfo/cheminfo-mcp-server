import { z } from 'zod';

/**
 * The MIME type of an MCP App's HTML (MCP Apps, 2026-01-26).
 */
export const APP_MIME_TYPE = 'text/html;profile=mcp-app';

/**
 * Who may call a tool: `model` (the LLM) and `app` (a view of this server).
 */
export const ToolVisibilitySchema = z.enum(['model', 'app']);

/**
 * How a tool's answer is shown: the resource that draws it, and who may call
 * the tool. Lenient: a field this version does not know is kept.
 */
export const ToolUiSchema = z.looseObject({
  resourceUri: z.string().optional(),
  visibility: z.array(ToolVisibilitySchema).optional(),
});

/**
 * The origins an app's page may load from and call (its CSP).
 */
export const AppCspSchema = z.looseObject({
  resourceDomains: z.array(z.string()).optional(),
  connectDomains: z.array(z.string()).optional(),
  frameDomains: z.array(z.string()).optional(),
  baseUriDomains: z.array(z.string()).optional(),
});

/**
 * The browser capabilities an app asks its host for, e.g.
 * `{ clipboardWrite: {} }`.
 */
export const AppPermissionsSchema = z.looseObject({
  camera: z.object({}).optional(),
  microphone: z.object({}).optional(),
  geolocation: z.object({}).optional(),
  clipboardWrite: z.object({}).optional(),
});

/**
 * An app resource's `_meta.ui`: its CSP, permissions, border and origin.
 */
export const AppResourceUiSchema = z.looseObject({
  csp: AppCspSchema.optional(),
  permissions: AppPermissionsSchema.optional(),
  domain: z.string().optional(),
  prefersBorder: z.boolean().optional(),
});

const MetaSchema = z.looseObject({ ui: AppResourceUiSchema.optional() });

/**
 * One resource of `GET resources`: what MCP's resources/list says of it,
 * and the version of its content, which changes when it does.
 */
export const ResourceListingSchema = z.object({
  uri: z.string().min(1),
  name: z.string(),
  description: z.string().optional(),
  mimeType: z.string(),
  /**
   * 12 hex of a SHA-256 over the content and its `_meta`.
   */
  version: z.string(),
  _meta: MetaSchema.optional(),
});

/**
 * `GET resources`.
 */
export const ResourceListSchema = z.object({
  resources: z.array(ResourceListingSchema),
});

/**
 * One content of a resource read: its page, as text.
 */
export const ResourceContentSchema = z.object({
  uri: z.string(),
  mimeType: z.string(),
  text: z.string(),
  _meta: MetaSchema.optional(),
});

/**
 * `GET resources/read?uri=…`: what MCP's resources/read answers.
 */
export const ResourceReadSchema = z.object({
  contents: z.array(ResourceContentSchema),
});

/**
 * Who may call a tool.
 */
export type ToolVisibility = z.infer<typeof ToolVisibilitySchema>;
/**
 * How a tool's answer is shown.
 */
export type ToolUi = z.infer<typeof ToolUiSchema>;
/**
 * An app's CSP.
 */
export type AppCsp = z.infer<typeof AppCspSchema>;
/**
 * The browser capabilities an app asks for.
 */
export type AppPermissions = z.infer<typeof AppPermissionsSchema>;
/**
 * An app resource's `_meta.ui`.
 */
export type AppResourceUi = z.infer<typeof AppResourceUiSchema>;
/**
 * One resource of `GET resources`.
 */
export type ResourceListing = z.infer<typeof ResourceListingSchema>;
/**
 * `GET resources`.
 */
export type ResourceList = z.infer<typeof ResourceListSchema>;
/**
 * `GET resources/read?uri=…`.
 */
export type ResourceRead = z.infer<typeof ResourceReadSchema>;

/**
 * Who may call a catalog's tool: the values of its `_meta.ui.visibility`
 * this version knows, else, when it says none, both the model and the
 * apps. A visibility of unknown values, or a `ui` that is not an object,
 * gives none: never offered to a model that should not see it.
 * @param tool - A catalog entry, or anything with its `_meta`.
 * @param tool._meta - The entry's `_meta`.
 * @returns The visibility.
 */
export function toolVisibility(tool: {
  _meta?: Record<string, unknown>;
}): ToolVisibility[] {
  const ui = tool._meta?.ui;
  if (ui === undefined) return ['model', 'app'];
  if (typeof ui !== 'object' || ui === null) return [];
  const { visibility } = ui as { visibility?: unknown };
  if (visibility === undefined) return ['model', 'app'];
  if (!Array.isArray(visibility)) return [];
  const known: ToolVisibility[] = [];
  for (const value of visibility) {
    const parsed = ToolVisibilitySchema.safeParse(value);
    if (parsed.success) known.push(parsed.data);
  }
  return known;
}

/**
 * Whether a model may be offered a catalog's tool: a host keeps the tools
 * only an app may call away from it.
 * @param tool - A catalog entry.
 * @param tool._meta - The entry's `_meta`.
 * @returns True unless the tool is for apps only.
 */
export function isModelVisible(tool: {
  _meta?: Record<string, unknown>;
}): boolean {
  return toolVisibility(tool).includes('model');
}

/**
 * Whether an app may call a catalog's tool.
 * @param tool - A catalog entry.
 * @param tool._meta - The entry's `_meta`.
 * @returns True unless the tool is for the model only.
 */
export function isAppVisible(tool: {
  _meta?: Record<string, unknown>;
}): boolean {
  return toolVisibility(tool).includes('app');
}
