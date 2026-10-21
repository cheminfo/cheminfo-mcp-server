# cheminfo-mcp-server

Serve tools to MCP clients and to the cheminfo chat from one definition, with the structures, reaction schemes, spectra and files they produce carried beside the answer, never through the model.

One tool definition gives a server these routes:

| Route                      | For                  | Answers                                                                                        |
| -------------------------- | -------------------- | ---------------------------------------------------------------------------------------------- |
| `GET tools`                | the chat, any client | the catalog: each tool's name, title, description, JSON Schema, hints and `_meta`              |
| `POST tools/{name}`        | the chat, the page   | `{ result, molecules, reactions?, spectra?, files?, structuredContent?, _meta? }`              |
| `POST mcp`                 | MCP clients          | MCP's Streamable HTTP, stateless: a server per request, JSON answers                           |
| `GET`, `DELETE mcp`        | MCP clients          | 405 with `Allow: POST`: no session is kept                                                     |
| `GET resources`            | a host speaking JSON | the MCP Apps the answers are drawn with, and the version of each                               |
| `GET resources/read?uri=…` | a host speaking JSON | one MCP App's page, as MCP's resources/read answers it, with its version as ETag (304 if held) |

`result` is what the model reads. The other fields are drawn by the page or the chat beside it. An MCP client has no such side channel, so MCP answers the result as JSON text, then the content of each file the tool produced, with `structuredContent` and `_meta` for a view.

## Installation

```console
npm install cheminfo-mcp-server
```

The server entry needs `fastify` (5) and `zod` (4). `cheminfo-mcp-server/client` and `cheminfo-mcp-server/contract` need only `zod`, and run in a browser. `cheminfo-mcp-server/views` needs only `zod`, and `@fastify/static` (10) for `registerViewAssets()`.

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

- A tool's schema is a zod object, strict unless made by `proxySchema()`: an unknown parameter is refused. A parameter set to `null` is left out before the arguments are checked, and a single value under another name is moved to a tool's only parameter, because small models rename it.
- A tool that throws answers 500 to the JSON route and an error result to MCP. The error itself never reaches the caller; `onError` is told.
- A tool refuses a call with its own status by throwing `new ToolRefusalError({ status: 503, code: 'loading', error: 'The copy is loading.', retryAfter: 30, extra: { mirror } })`. The JSON route answers that status, `{ error, code, ...extra }` and Retry-After; MCP answers `error` as an error result.
- A call is checked in order: the tool's name (404, worded by `unknownToolMessage`), `precheck` (a cheap check, e.g. that a credential is there at all), the arguments (400), then `resolveContext`: nothing is spent on a call that would be refused anyway. A `routes.run.schema` that sets `headers` or `body` is checked by Fastify first, before the name.
- `routes` sets each route's own `schema` (documentation for `@fastify/swagger`, headers, body, responses), `bodyLimit` and `config`: `{ catalog, run, mcp, mcpNotAllowed, resources, resourceRead }`. `withDocumentation()` types a schema's `tags`, `summary`, `description` and `hide` for Swagger. A `response` schema serializes exactly what it declares: one for `run` must declare `structuredContent` and `_meta`, and one for `catalog` each tool's `_meta`, or Fastify drops them.
- Tools are read-only by default (`READ_ONLY_ANNOTATIONS`); a tool says otherwise with `annotations`.
- `tools` may be a function, evaluated per request, when the descriptions change at run time.
- `routeConfig` is merged into the `config` of the two POST routes only (`run` and `mcp`), under their own, for `@fastify/rate-limit`.

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

A refusal answers its status before MCP starts, with `WWW-Authenticate: Bearer` on a 401. A 503 is the exception: MCP still lists the tools, and each call answers the refusal's sentence, so a client sees the tools while the server catches up. `route` is `'mcp'` or `'tools'`, for a server that accepts different credentials on each. The resolver also gets the `reply`, for what a refusal must change besides its body, such as clearing a session cookie that ended.

A server that resolves the context itself runs the call with `executeTool(tool, parameters, context, options)` once `parseToolArguments(tool, body)` has accepted the arguments; `runTool()` does both.

A browser `Origin` other than the page's own is refused on `POST mcp` unless listed in `allowedOrigins`, or unless `allowedOrigins` is `'*'`, which suits a server that reads no credential.

### A tool that forwards its calls

A tool answered by another server offers that server's JSON Schema as it is, and passes the arguments through unchecked, so the other server's own refusal, worded for the model, is what the model reads:

```ts
import { defineTool, proxySchema } from 'cheminfo-mcp-server';

const elnSearch = defineTool({
  name: 'elnSearch',
  title: 'Search the notebook',
  description: remote.description,
  schema: proxySchema(remote.inputSchema),
  execute: async (parameters) => ({
    result: await forward('elnSearch', parameters),
  }),
});
```

### Views: MCP Apps

A tool's answer can be drawn by a view, an HTML page the host loads in a sandbox ([MCP Apps](https://modelcontextprotocol.io/extensions/apps)). The tool names it with `ui`, the server serves it as a resource, and the answer carries what the view reads in `structuredContent` and `meta`, which the model never sees:

```ts
const search = defineTool({
  name: 'search',
  title: 'Search',
  description: 'Search the molecules.',
  schema: z.strictObject({ text: z.string() }),
  ui: { resourceUri: 'ui://molecules/view' },
  execute: async ({ text }) => {
    const hits = await find(text);
    return {
      result: { total: hits.length },
      meta: { 'org.cheminfo.molecules/view': { view: 'search', hits } },
    };
  },
});

createToolRoutes({
  name: 'molecules',
  version,
  tools: [search, searchPage],
  resources: (request) => [
    {
      uri: 'ui://molecules/view',
      name: 'Molecules',
      html: () => shellPage(request),
      csp: { resourceDomains: ['https://molecules.cheminfo.org'] },
      permissions: { clipboardWrite: {} },
      prefersBorder: true,
    },
  ],
});
```

- `ui` reaches tools/list as `_meta.ui` (and as `_meta["ui/resourceUri"]` for older hosts) and each catalog entry as `_meta.ui`; `meta` on a tool adds fields of its own.
- `ui.visibility: ['app']` makes a tool for the view only, e.g. its next page: it is listed with that visibility, so a host keeps it from the model (`isModelVisible()` in the contract), and it is callable on `POST tools/{name}` like any other.
- An answer whose `_meta` is longer than `metaWarnSize` characters of JSON (60,000), or whose result is longer than `resultWarnSize` (100,000), is logged as a warning, by tool and size; `runTool()` and `executeTool()` tell `onLargeMeta` and `onLargeResult` instead.
- `resources` may be a function of the request, when the page's assets are served from the request's origin. A server without `resources` has no resource routes. When the resources cannot be listed, MCP serves the tools without them and logs why; of two resources with one uri, the first is served.

`cheminfo-mcp-server/views` serves a view built by Vite from the same server:

```ts
import {
  readViewBuild,
  registerViewAssets,
  viewResource,
  viewsBaseUrl,
} from 'cheminfo-mcp-server/views';

const build = await readViewBuild(viewsRoot); // undefined until built
await registerViewAssets(app, {
  root: viewsRoot,
  retainDirectory: 'data/views',
});
const resources = (request) =>
  build === undefined
    ? []
    : [
        viewResource(build, {
          baseUrl: viewsBaseUrl(process.env.PUBLIC_URL, request),
          uri: 'ui://molecules/view',
          name: 'Molecules',
          prefersBorder: true,
        }),
      ];
```

- `readViewBuild()` reads the Vite manifest and checks the build: one entry, every file in its flat `assets` folder. `preload` names the chunks imported on demand that the page fetches at once (`['openchemlib']`).
- `viewResource()` writes a small page that loads the hashed entry, its imports and its stylesheets from `<baseUrl><assetsPath>/`, with a CSP naming that origin and no origin to call. `assetsPath` (`views/assets`) is `registerViewAssets()`'s `prefix` without its leading slash. A base URL that is not a plain http(s) address is refused, since a request's host is a header anyone can write.
- `registerViewAssets()` serves those files to any origin, without credentials, cached for a year; anything else under the prefix is a 404, never a page. `root` and `retainDirectory` may be relative to the working directory. `retainDirectory` keeps the assets of earlier builds for `retainDays` (30), so a view opened before a deploy still finds its chunks; it must hold nothing else, since a file no build has had for that long is deleted.
- With `loader: true` on both, the page loads `<assets>/loader.js` (`VIEW_LOADER_FILE`), whose name never changes and which is asked again every time (`VIEW_LOADER_CACHE_CONTROL`), and the loader (`viewLoaderScript()`) imports the current hashed entry. The page then never changes with the build, so a host that keeps it (a card reopened from an old conversation) still loads the current one after a deploy.

### A bridge

A server that serves another server's tools again, such as an MCP server over stdio, passes their views on: each forwarded tool takes `meta: entry._meta` from the catalog, returns the call's `structuredContent` and `_meta` as its own, and each resource is `forwardAppResource(listing, readHtml)`, its page read from the other server whenever a host reads it. `createMcpServer({ name, version, tools, resources, context })` builds that MCP server; its `resources` may also be its own.

A host that calls the JSON route feeds a view what MCP would have given it with `toCallToolResult(reply)` from the contract: `{ content, structuredContent?, _meta? }`, and a refusal with `toErrorCallToolResult(message)`: `{ content, isError: true }`. `executeTool()` answers `structuredContent` and `_meta` too, for a server that runs its tools itself.

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

`resources()` lists the views, and `readResource(uri)` reads one, asking again with its ETag and reusing the page the server says is unchanged.

Every reply is checked against the contract. A malformed side channel is dropped, never the result. A redirect is never followed, so a credential never leaves for another address. A failure is `refused` (the server's own code and sentence, with Retry-After, and its whole refusal in `reply`, the server's own fields included), `unreachable`, `timeout` or `invalid-reply`.

## The contract

`cheminfo-mcp-server/contract` holds the zod schemas and types every side shares: `ToolCatalogSchema`, `ToolRunReplySchema`, `ErrorReplySchema`, `DisplayMoleculeSchema`, `DisplayReactionSchema`, `DisplaySpectrumSchema` and `DisplayFileSchema`, with their limits (`MAX_MOLECULES`, `MAX_REACTIONS`, `MAX_SPECTRA`, `MAX_FILES`), and for views `ResourceListSchema`, `ResourceReadSchema`, `ToolUiSchema`, `AppCspSchema`, `AppPermissionsSchema`, `AppResourceUiSchema`, `APP_MIME_TYPE`, `toolVisibility()`, `isModelVisible()`, `isAppVisible()` and `toCallToolResult()`. The `_meta` fields are lenient: a field this version does not know is kept. A visibility value this version does not know is never read as `model`.

## License

[MIT](./LICENSE)
