import type { z } from 'zod';

import type { ResourceRead, ToolCatalog } from '../contract/index.ts';
import {
  ResourceListSchema,
  ResourceReadSchema,
  ToolCatalogSchema,
  ToolRunReplySchema,
} from '../contract/index.ts';

import { fail, readResponse } from './readResponse.ts';
import type {
  ToolCallOptions,
  ToolClient,
  ToolClientOptions,
  ToolClientResult,
} from './types.ts';

/**
 * A client of a tool server's JSON API. Every reply is checked against the
 * contract; a redirect is never followed, so a credential never leaves for
 * another address; each call carries an `x-request-id`.
 * @param options - The server, the fetch, headers, timeouts and the cache.
 * @returns The client.
 */
export function createToolClient(options: ToolClientOptions): ToolClient {
  const base = new URL(options.baseUrl);
  const fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
  const { catalogTtlMs = 60_000, now = Date.now } = options;
  const timeouts = { catalog: 5000, tool: 60_000, ...options.timeouts };
  let cached: { at: number; value: ToolCatalog } | null = null;
  const remember = (value: ToolCatalog) => {
    cached = { at: now(), value };
  };

  const pages = new Map<string, { etag: string; value: ResourceRead }>();

  async function call<Schema extends z.ZodType>(
    url: URL,
    init: RequestInit,
    timeoutMs: number,
    schema: Schema,
    callOptions: ToolCallOptions,
  ): Promise<ToolClientResult<z.output<Schema>>> {
    const sent = await send(url, init, timeoutMs, callOptions);
    return sent.ok ? readResponse(sent.response, schema) : sent;
  }

  async function send(
    url: URL,
    init: RequestInit,
    timeoutMs: number,
    callOptions: ToolCallOptions,
  ): Promise<ReturnType<typeof fail> | { ok: true; response: Response }> {
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (callOptions.signal) signals.push(callOptions.signal);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        ...init,
        redirect: 'manual',
        signal: AbortSignal.any(signals),
        headers: {
          accept: 'application/json',
          'x-request-id': crypto.randomUUID(),
          ...options.headers,
          ...callOptions.headers,
          ...(init.body !== undefined && {
            'content-type': 'application/json',
          }),
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    } catch (error) {
      const isLate =
        error instanceof DOMException && error.name === 'TimeoutError';
      return fail(
        isLate ? 'timeout' : 'unreachable',
        null,
        isLate
          ? 'The tool server did not answer in time.'
          : 'Cannot reach the tool server.',
      );
    }
    return { ok: true, response };
  }

  return {
    async catalog(callOptions = {}) {
      if (cached && now() - cached.at < catalogTtlMs) {
        return { ok: true, value: cached.value };
      }
      const result = await call(
        new URL('tools', base),
        { method: 'GET' },
        timeouts.catalog,
        ToolCatalogSchema,
        callOptions,
      );
      if (result.ok) remember(result.value);
      return result;
    },
    callTool(name, parameters, callOptions = {}) {
      return call(
        new URL(`tools/${encodeURIComponent(name)}`, base),
        { method: 'POST', body: JSON.stringify(parameters) },
        timeouts.tool,
        ToolRunReplySchema,
        callOptions,
      );
    },
    resources(callOptions = {}) {
      return call(
        new URL('resources', base),
        { method: 'GET' },
        timeouts.catalog,
        ResourceListSchema,
        callOptions,
      );
    },
    async readResource(uri, callOptions = {}) {
      const url = new URL('resources/read', base);
      url.searchParams.set('uri', uri);
      const known = pages.get(uri);
      const sent = await send(
        url,
        {
          method: 'GET',
          ...(known && { headers: { 'if-none-match': known.etag } }),
        },
        timeouts.catalog,
        callOptions,
      );
      if (!sent.ok) return sent;
      if (sent.response.status === 304 && known) {
        return { ok: true, value: known.value };
      }
      const result = await readResponse(sent.response, ResourceReadSchema);
      const etag = sent.response.headers.get('etag');
      if (result.ok && etag !== null) {
        pages.set(uri, { etag, value: result.value });
      }
      return result;
    },
  };
}
