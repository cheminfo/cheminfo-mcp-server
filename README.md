# cheminfo-mcp-server

Serve tools to MCP clients and to the cheminfo chat from one definition, with the structures, reaction schemes, spectra, curves and files they produce carried beside the answer, never through the model.

One tool definition gives a server these routes:

| Route                      | For                  | Answers                                                                                                      |
| -------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GET tools`                | the chat, any client | the catalog: each tool's name, title, description, JSON Schema, hints and `_meta`, and the example questions |
| `POST tools/{name}`        | the chat, the page   | `{ result, molecules, reactions?, spectra?, curves?, files?, structuredContent?, _meta? }`                   |
| `POST mcp`                 | MCP clients          | MCP's Streamable HTTP, stateless: a server per request, JSON answers                                         |
| `GET`, `DELETE mcp`        | MCP clients          | 405 with `Allow: POST`: no session is kept                                                                   |
| `GET resources`            | a host speaking JSON | the MCP Apps the answers are drawn with, and the version of each                                             |
| `GET resources/read?uri=…` | a host speaking JSON | one MCP App's page, as MCP's resources/read answers it, with its version as ETag (304 if held)               |

`result` is what the model reads. The other fields are drawn by the page or the chat beside it. An MCP client has no such side channel, so MCP answers the result as JSON text, then the content of each file the tool produced, with `structuredContent` and `_meta` for a view.

## Installation

```console
npm install cheminfo-mcp-server
```

The server entry needs `fastify` (5) and `zod` (4), and `@fastify/swagger` (9) with `@fastify/swagger-ui` (6) for `registerToolApi()`. `cheminfo-mcp-server/client` and `cheminfo-mcp-server/contract` need only `zod`, and run in a browser. `cheminfo-mcp-server/views` needs only `zod`, and `@fastify/static` (10) for `registerViewAssets()`. `cheminfo-mcp-server/threads` needs nothing and loads nothing but Node's `worker_threads`. `cheminfo-mcp-server/testing` needs `fastify`.

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
- A tool refuses a call with its own status by throwing `new ToolRefusalError({ status: 503, code: 'loading', error: 'The copy is loading.', retryAfter: 30, extra: { mirror } })`. The JSON route answers that status, `{ error, code, ...extra }` and Retry-After; MCP answers `error` as an error result. The common refusals have a helper each (see [Refusals](#refusals)).
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

### A site's own page as the view

A site whose page already draws the answer, at an address under `?embed=1`,
needs no view of its own: `embedView` is a small MCP App that frames that page,
and `embedMeta(card, { page })` is what an answer carries for it to show.

- **Inline, the card.** `card` is a small page drawing only what the question
  asked (usually the page with `card=1`). The frame is as tall as the card
  reports, never taller than the host allows (`containerDimensions.maxHeight`),
  so nothing scrolls twice. A host that fixes the height
  (`containerDimensions.height`) gets a frame of that height, in which the card
  scrolls. A card that has not reported after 8 s is taken as not loaded: it
  is folded to one line, "The card did not load. Open the page", and comes
  back as soon as it reports. A view whose page cannot report sets `height`,
  and such a page is then framed at that height.
- **Over the full screen, the full page.** `page` is the whole page, shown when
  the user asks for more: from the host's own control, or from the card. It is
  loaded on first use and kept. When the card is shown again, the view asks it
  for its height, which may have changed while it was hidden.

The view frames exactly the http(s) addresses it checked, of the origins it
names. It asks the host for the clipboard (`permissions.clipboardWrite`) and
passes it on, with the full screen, to the card and the page, so their own copy
and full-screen buttons work wherever the host grants both to the view.

```ts
import { createToolRoutes, embedMeta, embedView } from 'cheminfo-mcp-server';

const titration = defineTool({
  name: 'titrationCurve',
  // …
  ui: { resourceUri: 'ui://equilibrium/page' },
  execute: (args) => {
    const page = `https://equilibrium.cheminfo.org/titration?${query(args)}&embed=1`;
    return {
      result: computeTitration(args),
      meta: embedMeta(`${page}&card=1`, { page }),
    };
  },
});

createToolRoutes({
  name: 'equilibrium',
  version,
  tools: [titration],
  resources: [
    embedView({
      uri: 'ui://equilibrium/page',
      name: 'equilibrium.cheminfo.org',
      origins: ['https://equilibrium.cheminfo.org'],
    }),
  ],
});
```

The card speaks to its view with `cheminfo-mcp-server/embed`, which has no
dependency and runs in the browser:

```tsx
import { openSitePage, reportEmbedHeight } from 'cheminfo-mcp-server/embed';
import { useEffect, useRef } from 'react';

export function AnswerCard() {
  const cardRef = useRef<HTMLDivElement>(null);
  // The frame fits the card: measure the element holding all of it. A ref not
  // attached yet reports nothing.
  useEffect(() => reportEmbedHeight(cardRef.current), []);

  return (
    <div ref={cardRef}>
      …<button onClick={() => openSitePage(sitePageAddress)}>Details</button>
    </div>
  );
}
```

`openSitePage(url)` shows the site's own page, the card's address without
its card, `embed` and `hide` parameters. Framed by a chat it opens a new
window, so the conversation stays where it was; the window is opened without
`noopener` (which would make `open` return null even when it worked) and its
`opener` is cleared at once. When the host refuses the window, because its
frames allow no popup, it falls back to `requestEmbedExpand()`. A card opened
on its own goes to the page in place.

`requestEmbedExpand()` belongs in a click handler: the view acts on it only
while the click's activation lasts, so a card can never open anything by
itself. The view then asks the host for the full screen, and when the host
refuses, the card stays inline, the host's own control still at hand. It opens
the site's page in a new tab (`ui/open-link`, which a host confirms with the
user) only when the host has no full screen, or when the full screen already
shows the card because the answer has no `page`.

#### The page inside a chat

A chat draws the view in a sandboxed frame, and every frame inside it inherits
the sandbox: the card and the page run in an opaque origin (`origin` is
`'null'`). `installEmbedPage()` prepares a framed page for it, and does nothing
in a page opened on its own:

```ts
// src/embedPage.ts
import { installEmbedPage } from 'cheminfo-mcp-server/embed';

installEmbedPage();
```

```ts
// src/main.ts: imported first, so it runs before any other module
import './embedPage.ts';
import { App } from './App.tsx';
```

It must run before any module that makes a worker or changes the address is
evaluated. A module's static imports are all evaluated before its first
statement, so a call at the top of the entry module comes too late when one of
its imports starts a worker: call it in a module of its own that the entry
imports first, as above, or call it and then import the app dynamically
(`await import('./start.tsx')`).

What a framed page can and cannot do:

- **Storage throws.** `localStorage`, `sessionStorage` and IndexedDB throw in an
  opaque origin: use them in a `try`, and work without them.
- **Every request is cross-origin.** The site's server sends
  `Access-Control-Allow-Origin: *` on the built assets (module scripts load with
  CORS), on what the page fetches, and on what its workers load.
- **Workers** start as classic workers from a `blob:` URL, in the page's own
  origin (`installSandboxWorkers()`). The address given to `new Worker()`
  resolves against the document's base URL. A module is run by a dynamic
  `import()`, and the messages posted before it listens are held, then
  delivered. Inside the worker a relative `fetch()`, `XMLHttpRequest` or
  `importScripts()` resolves against the real script, and a `Blob` can be read,
  which WebKit refuses in a worker started from a `data:` URL.
  `self.location` is the `blob:` URL, so what is built from it fails, such as
  the asset addresses of Vite's default `iife` worker format, which rewrites
  `import.meta.url` to `self.location.href`. Use module workers
  (`type: 'module'`, Vite `worker.format: 'es'`), whose `import.meta.url` is
  the script's own address. A `data:` or `blob:` worker is started as it is,
  and a module `blob:` one does not run in Chromium. Firefox refuses a worker's
  `fetch()` of a `blob:` URL: read the `Blob` itself.
- **History in Safari.** WebKit lets a page in an opaque origin change only its
  query and fragment with `history.pushState()` and `replaceState()`;
  `installSandboxHistory()` navigates to an address it refuses instead, and the
  page loads again there, without the state it was given. Name the card and the
  page by their final paths, and keep the moves inside a framed page to the
  query.
- **Copy and full screen** work in the card and the page once the host grants
  them to the view.
- **Escape** in the card or the page leaves the full screen: the page forwards
  it (`cheminfo:embed-collapse`) unless the page prevented it, or one of its
  dialogs (`[aria-modal="true"]`) is open.

In a frame, `installEmbedPage()` forwards Escape and calls
`installSandboxWorkers()` and `installSandboxHistory()`, which act in an opaque
origin only; both are exported on their own too.

### The API and its documentation

`registerToolApi()` registers the whole API of a site: the tool routes under
`/v1`, their OpenAPI documentation at `/docs` (the document at `/docs/json`)
and the JSON 404 of `/.well-known/*`. The document names its server
relatively (`..`) and keeps the paths' `/v1`, so "Try it out" also works when
the site is served under a path.

```ts
import { registerToolApi } from 'cheminfo-mcp-server';

await registerToolApi(
  app,
  { name: 'equilibrium', version, tools, examples, allowedOrigins: '*' },
  {
    title: 'equilibrium.cheminfo.org tools',
    description:
      'The pH of a solution and titration curves, for chats and MCP clients.',
  },
);
```

Register it before the routes it should document; it registers
`wellKnownNotFound` itself. The documentation's `version` defaults to the
routes'.

### Refusals

A refusal is a status, a code a client branches on and a sentence the model
reads. `REFUSAL_CODES` lists the codes every server of the family answers
with, the status of each and when it is used; a server may add its own.

| Helper                            | Status | Code                |
| --------------------------------- | ------ | ------------------- |
| `refuseInvalid(message)`          | 400    | `invalid-arguments` |
| `refuseNotFound(message)`         | 404    | `not-found`         |
| `refuseTimeout(message)`          | 422    | `timeout`           |
| `refuseBusy(message, retryAfter)` | 503    | `busy`, Retry-After |

Each throws a `ToolRefusalError`, so it ends a tool where it is called:

```ts
import { refuseInvalid } from 'cheminfo-mcp-server/threads';

if (!isFormula(mf))
  refuseInvalid(
    `"${mf}" is not a molecular formula: give one such as C6H12O6.`,
  );
```

`retryAfter` defaults to 5 seconds. The routes answer 500 `internal` for any
other error.

### Calls that may run too long: threads

A call that may hold the server — a solver that can spin without end, a
regular expression that backtracks catastrophically, WebAssembly that cannot
be asked to stop — runs in a worker thread, which is terminated when its time
is up. `cheminfo-mcp-server/threads` loads neither Fastify nor the MCP SDK nor
zod, so a thread starts in milliseconds rather than the tenths of a second the
main entry costs, and its `ToolRefusalError` is the very class of the main
entry.

The thread's module answers the calls posted to it:

```ts
// server/tools/solverThread.ts
import { refuseInvalid, serveToolThread } from 'cheminfo-mcp-server/threads';

serveToolThread((job: SolverJob) => {
  if (job.components.length === 0) refuseInvalid('Give at least one compound.');
  return solve(job);
});
```

`runToolInThread()` runs one call in a fresh thread, ended once it answers:

```ts
import { runToolInThread } from 'cheminfo-mcp-server/threads';

const answer = await runToolInThread<SolverJob, ToolAnswer>(
  new URL('solverThread.ts', import.meta.url),
  job,
  {
    timeoutMs: 10_000,
    heapMb: 128,
    busyMessage: (count) =>
      `The server is already solving ${count} equilibria: try again in a few seconds.`,
    timeoutMessage: (seconds) =>
      `The solver found no answer within ${seconds} s: leave a compound out.`,
  },
);
```

- At most `maxThreads` calls (2) run at once in the process; one more is
  refused at once with 503 `busy` and Retry-After (`retryAfter`, 5 s), never
  queued.
- A call past `timeoutMs` (10 s, the thread's start included) is refused with
  422 `timeout`, worded by `timeoutMessage(seconds, job)`, and its thread
  terminated.
- A `ToolRefusalError` thrown in the thread is the caller's refusal; any other
  error rejects with its message. The answer must survive `postMessage`.
- The thread's heap is capped at `heapMb` (256); reaching it rejects with
  `ERR_WORKER_OUT_OF_MEMORY`. No flag of this process reaches the thread
  (`execArgv: []`): `--watch` is refused there, and type stripping needs none.

`createToolThreadPool()` keeps its threads loaded between calls, for a module
that loads something heavy such as OpenChemLib:

```ts
import { createToolThreadPool } from 'cheminfo-mcp-server/threads';

const pool = createToolThreadPool<ToolJob, ToolAnswer>({
  threadUrl: new URL('tools/toolThread.ts', import.meta.url),
  threads: 2,
  maxWaiting: 4,
  deadlineMs: 20_000,
});
const answer = await pool.run(job);
app.addHook('onClose', () => pool.close());
```

- No thread starts before the first call. A thread left idle stays, without
  holding the process open.
- `maxWaiting` calls (4) wait for a thread; one more is refused with 503
  `busy`. A call past `deadlineMs` (20 s, the thread's start included) is
  refused with 422 `timeout`, and its thread thrown away.
- A thread that cannot start, or stops without answering, rejects the call
  with the cause; the pool goes on with a new thread.
- The pool posts `{ id, request }`, the family's worker request. A thread
  that answers in its own protocol, such as the page's worker
  (`{ id, ok, response }`), is read through `decode(message)`, which returns
  the reply `serveToolThread()` would have posted:
  `{ id, ok: true, answer }`, `{ id, ok: false, refusal }` or
  `{ id, ok: false, failure }`.

### Example questions

`examples` lists questions the tools answer, with what a correct answer
contains. `GET tools` returns them, so a chat shows them to its users and a
benchmark asks them again; a server without examples keeps the catalog, and its
version, it had.

```ts
createToolRoutes({
  name: 'equilibrium',
  version,
  tools,
  examples: [
    {
      question: 'What is the pH of 0.1 M acetic acid?',
      expect: '2.85',
      tools: ['solutionPh'],
      category: 'Solutions',
    },
  ],
});
```

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

## Testing a server

`cheminfo-mcp-server/testing` calls a server the way the chat and MCP clients
do, through Fastify's `inject`:

```ts
import {
  checkToolExamples,
  injectMcpRequest,
  injectToolCall,
} from 'cheminfo-mcp-server/testing';

const response = await injectToolCall(app, 'solutionPh', { components });
const list = await injectMcpRequest(app, { method: 'tools/list' });
```

`injectMcpRequest(app, { method, params, id })` sends the JSON-RPC request
with the headers of an MCP client (`id` 1 by default). Both take `prefix`
(`/v1`) and more `headers` as options.

`checkToolExamples()` answers every example question without a model: it runs
the call a model makes for each and checks that the result already holds
every text a correct answer contains, ignoring case. It returns the problems,
one sentence each naming its question:

```ts
const CALLS = {
  'What is the pH of 0.1 M acetic acid?': {
    tool: 'solutionPh',
    arguments: { components: [{ name: 'acetic acid', concentration: 0.1 }] },
  },
};

test('every example is answered by the call a model makes', async () => {
  expect(
    await checkToolExamples({ examples: EXAMPLES, calls: CALLS, app }),
  ).toStrictEqual([]);
});
```

A problem is a question without a call, a call without a question, a call to a
tool the example does not name, a call not answered with 200, or a text the
result lacks. The calls run one after the other, as a server limits the calls
it runs at once.

## The contract

`cheminfo-mcp-server/contract` holds the zod schemas and types every side shares: `ToolCatalogSchema` (with `ToolExampleSchema`), `ToolRunReplySchema`, `ErrorReplySchema`, `DisplayMoleculeSchema` (with optional `measurements`: two to four zero-based atom indices into its `molfile3D` each, drawn on the 3D model as a distance, an angle or a dihedral), `DisplayMeasurementSchema`, `DisplayReactionSchema`, `DisplaySpectrumSchema`, `DisplayCurveSchema` (a titration curve: two axes of equal length, each with its title, readout symbol, decimals and an optional fixed range) and `DisplayFileSchema`, with their limits (`MAX_MOLECULES`, `MAX_MEASUREMENTS`, `MAX_REACTIONS`, `MAX_SPECTRA`, `MAX_CURVES`, `MAX_CURVE_POINTS`, `MAX_FILES`), and for views `ResourceListSchema`, `ResourceReadSchema`, `ToolUiSchema`, `AppCspSchema`, `AppPermissionsSchema`, `AppResourceUiSchema`, `APP_MIME_TYPE`, `toolVisibility()`, `isModelVisible()`, `isAppVisible()` and `toCallToolResult()`. The `_meta` fields are lenient: a field this version does not know is kept. A visibility value this version does not know is never read as `model`.

## License

[MIT](./LICENSE)
