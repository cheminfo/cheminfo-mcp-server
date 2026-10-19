# cheminfo-mcp-server

Serve tools to MCP clients and to the cheminfo chat from one definition, with the structures, reaction schemes, spectra and files they produce carried beside the answer, never through the model.

One tool definition gives a server three routes:

| Route               | For                  | Answers                                                                         |
| ------------------- | -------------------- | ------------------------------------------------------------------------------- |
| `GET tools`         | the chat, any client | the catalog: each tool's name, title, description, strict JSON Schema and hints |
| `POST tools/{name}` | the chat, the page   | `{ result, molecules, reactions?, spectra?, files? }`                           |
| `POST mcp`          | MCP clients          | MCP's Streamable HTTP, stateless: a server per request, JSON answers            |

`result` is what the model reads. The other fields are drawn by the page or the chat beside it. An MCP client has no such side channel, so MCP answers the result as JSON text, then the content of each file the tool produced.

## Installation

```console
npm install cheminfo-mcp-server
```

The server entry needs `fastify` (5) and `zod` (4). `cheminfo-mcp-server/client` and `cheminfo-mcp-server/contract` need only `zod`, and run in a browser.

## A server

```ts
import { fastify } from 'fastify';
import {
  createToolRoutes,
  defineTool,
  wellKnownNotFound,
} from 'cheminfo-mcp-server';
import { z } from 'zod';

const mfInfo = defineTool({
  name: 'mfInfo',
  title: 'Molecular formula',
  description: 'Mass and composition of a molecular formula, e.g. "C6H12O6".',
  schema: z.strictObject({ mf: z.string() }),
  execute: ({ mf }) => ({
    result: { mf, monoisotopicMass: 180.0634 },
    molecules: [{ smiles: 'OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O' }],
  }),
});

const app = fastify();
await app.register(wellKnownNotFound);
await app.register(
  createToolRoutes({
    name: 'molecules',
    version: '1.0.0',
    instructions: 'Tools on molecules and molecular formulas.',
    tools: [mfInfo],
  }),
  { prefix: '/v1' },
);
```

- A tool's schema is a strict zod object: an unknown parameter is refused. A parameter set to `null` is left out, and a single value under another name is moved to a tool's only parameter, because small models rename it.
- A tool that throws answers 500 to the JSON route and an error result to MCP. The error itself never reaches the caller; `onError` is told.
- A tool refuses a call with its own status by throwing `new ToolRefusalError({ status: 503, code: 'loading', error: 'The copy is loading.', retryAfter: 30, extra: { mirror } })`. The JSON route answers that status, `{ error, code, ...extra }` and Retry-After; MCP answers `error` as an error result.
- An unknown tool is a 404 before the caller is checked; `unknownToolMessage` words it.
- Tools are read-only by default (`READ_ONLY_ANNOTATIONS`); a tool says otherwise with `annotations`.
- `tools` may be a function, evaluated per request, when the descriptions change at run time.
- `routeConfig` is merged into the `config` of the two POST routes, for `@fastify/rate-limit`.

### Who is asking

A server whose tools need to know the caller resolves a context per request:

```ts
createToolRoutes<{ email: string }>({
  name: 'scipeaks-mcp',
  version,
  tools,
  resolveContext: async (request, route) => {
    const email = await checkToken(request.headers['x-eln-token']);
    return email === null
      ? {
          ok: false,
          refusal: {
            status: 401,
            code: 'no-credentials',
            error: 'Send your token.',
          },
        }
      : { ok: true, context: { email } };
  },
});
```

A refusal answers its status before MCP starts, with `WWW-Authenticate: Bearer` on a 401. A 503 is the exception: MCP still lists the tools, and each call answers the refusal's sentence, so a client sees the tools while the server catches up. `route` is `'mcp'` or `'tools'`, for a server that accepts different credentials on each.

A browser `Origin` other than the page's own is refused on `POST mcp` unless listed in `allowedOrigins`, or unless `allowedOrigins` is `'*'`, which suits a server that reads no credential.

## A client

```ts
import { createToolClient } from 'cheminfo-mcp-server/client';

const molecules = createToolClient({
  baseUrl: 'https://molecules.cheminfo.org/v1/',
});
const catalog = await molecules.catalog();
const run = await molecules.callTool('mfInfo', { mf: 'C6H12O6' });
if (run.ok) {
  console.log(run.value.result, run.value.molecules);
} else {
  console.log(run.failure.kind, run.failure.message);
}
```

Every reply is checked against the contract. A malformed side channel is dropped, never the result. A redirect is never followed, so a credential never leaves for another address. A failure is `refused` (the server's own code and sentence, with Retry-After, and its whole refusal in `reply`, the server's own fields included), `unreachable`, `timeout` or `invalid-reply`.

## The contract

`cheminfo-mcp-server/contract` holds the zod schemas and types every side shares: `ToolCatalogSchema`, `ToolRunReplySchema`, `ErrorReplySchema`, `DisplayMoleculeSchema`, `DisplayReactionSchema`, `DisplaySpectrumSchema` and `DisplayFileSchema`, with their limits (`MAX_MOLECULES`, `MAX_REACTIONS`, `MAX_SPECTRA`, `MAX_FILES`).

## License

[MIT](./LICENSE)
