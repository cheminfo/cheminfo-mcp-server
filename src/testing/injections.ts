import type { FastifyInstance, LightMyRequestResponse } from 'fastify';

/**
 * A server the tests inject requests into: a Fastify instance, whatever its
 * type provider.
 */
export type InjectableServer = Pick<FastifyInstance, 'inject'>;

/**
 * Where the tool routes are, and what each request carries.
 */
export interface InjectOptions {
  /**
   * The prefix the tool routes are registered under.
   * @default '/v1'
   */
  prefix?: string;
  /**
   * More headers, e.g. a credential.
   * @default {}
   */
  headers?: Record<string, string>;
}

/**
 * One JSON-RPC request of an MCP client.
 */
export interface McpRequestBody {
  /**
   * E.g. `tools/list`, `tools/call`.
   */
  method: string;
  /**
   * The method's parameters.
   * @default undefined - none sent
   */
  params?: Record<string, unknown>;
  /**
   * The request's id.
   * @default 1
   */
  id?: number | string;
}

/**
 * Call one tool on its JSON route, `POST <prefix>/tools/<name>`.
 * @param app - The server.
 * @param name - The tool.
 * @param parameters - Its arguments, the body.
 * @param options - The prefix and more headers.
 * @returns The response.
 */
export function injectToolCall(
  app: InjectableServer,
  name: string,
  parameters: Record<string, unknown> = {},
  options: InjectOptions = {},
): Promise<LightMyRequestResponse> {
  const { prefix = '/v1', headers = {} } = options;
  return app.inject({
    method: 'POST',
    url: `${prefix}/tools/${encodeURIComponent(name)}`,
    headers,
    payload: parameters,
  });
}

/**
 * Send one JSON-RPC request to `POST <prefix>/mcp`, with the headers an MCP
 * client sends.
 * @param app - The server.
 * @param body - The method, its parameters and the id.
 * @param options - The prefix and more headers.
 * @returns The response, whose JSON is the JSON-RPC answer.
 */
export function injectMcpRequest(
  app: InjectableServer,
  body: McpRequestBody,
  options: InjectOptions = {},
): Promise<LightMyRequestResponse> {
  const { prefix = '/v1', headers = {} } = options;
  const { method, params, id = 1 } = body;
  return app.inject({
    method: 'POST',
    url: `${prefix}/mcp`,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    payload: {
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined && { params }),
    },
  });
}
