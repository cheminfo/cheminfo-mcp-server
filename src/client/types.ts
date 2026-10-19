import type { ToolCatalog, ToolRunReply } from '../contract/index.ts';

/**
 * A fetch: the global one, or a test's fake.
 */
export type FetchLike = (url: URL, init: RequestInit) => Promise<Response>;

/**
 * Why a call gave no answer.
 */
export interface ToolClientFailure {
  /**
   * `refused`: the server answered an error; `unreachable`: no answer;
   * `timeout`: too late; `invalid-reply`: an answer outside the contract.
   */
  kind: 'refused' | 'unreachable' | 'timeout' | 'invalid-reply';
  /**
   * The HTTP status, or null without an answer.
   */
  status: number | null;
  /**
   * The server's code (`not-found`, `invalid-arguments`…), or null.
   */
  code: string | null;
  /**
   * The server's sentence, or ours; never a URL or a credential.
   */
  message: string;
  /**
   * Seconds to wait, from Retry-After, or null.
   */
  retryAfter: number | null;
}

/**
 * An answer, or why there is none.
 */
export type ToolClientResult<T> =
  { ok: true; value: T } | { ok: false; failure: ToolClientFailure };

/**
 * What one call may carry.
 */
export interface ToolCallOptions {
  /**
   * More headers for this call: a token, a time zone.
   * @default {}
   */
  headers?: Record<string, string>;
  /**
   * Aborts the call, besides its timeout.
   * @default undefined
   */
  signal?: AbortSignal;
}

/**
 * Options of `createToolClient`.
 */
export interface ToolClientOptions {
  /**
   * The API root, with its trailing slash: `https://example.org/v1/`.
   */
  baseUrl: URL | string;
  /**
   * The fetch the calls are made with.
   * @default globalThis.fetch
   */
  fetch?: FetchLike;
  /**
   * Headers sent with every call.
   * @default {}
   */
  headers?: Record<string, string>;
  /**
   * Milliseconds before a call is abandoned.
   * @default { catalog: 5000, tool: 60000 }
   */
  timeouts?: { catalog?: number; tool?: number };
  /**
   * How long a catalog that was read is reused, in milliseconds.
   * @default 60000
   */
  catalogTtlMs?: number;
  /**
   * The clock of the catalog cache, in epoch ms.
   * @default Date.now
   */
  now?: () => number;
}

/**
 * Calls the tools of one server.
 */
export interface ToolClient {
  /**
   * `GET tools`, reused for `catalogTtlMs`.
   */
  catalog: (
    options?: ToolCallOptions,
  ) => Promise<ToolClientResult<ToolCatalog>>;
  /**
   * `POST tools/{name}`.
   */
  callTool: (
    name: string,
    parameters: Record<string, unknown>,
    options?: ToolCallOptions,
  ) => Promise<ToolClientResult<ToolRunReply>>;
}
