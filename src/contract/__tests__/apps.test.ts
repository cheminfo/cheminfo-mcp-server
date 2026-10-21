import { expect, test } from 'vitest';

import {
  ResourceListSchema,
  ToolRunReplySchema,
  isAppVisible,
  isModelVisible,
  toolVisibility,
} from '../index.ts';

test("a tool's visibility is the known values of its _meta.ui's, else the model's and the apps'; unknown values give none", () => {
  const tools = [
    {},
    { _meta: { ui: { resourceUri: 'ui://a/b' } } },
    { _meta: { ui: { visibility: ['app'] } } },
    { _meta: { ui: { visibility: ['model'] } } },
    { _meta: { ui: { visibility: ['nobody'] } } },
    { _meta: { ui: { visibility: ['model', 'future'] } } },
    { _meta: { ui: { visibility: 'app' } } },
    { _meta: { ui: 'x' } },
  ];

  expect(
    tools.map((tool) => [
      toolVisibility(tool),
      isModelVisible(tool),
      isAppVisible(tool),
    ]),
  ).toStrictEqual([
    [['model', 'app'], true, true],
    [['model', 'app'], true, true],
    [['app'], false, true],
    [['model'], true, false],
    [[], false, false],
    [['model'], true, false],
    [[], false, false],
    [[], false, false],
  ]);
});

test('a malformed structuredContent or _meta is dropped, never the answer the model reads', () => {
  expect(
    ToolRunReplySchema.parse({
      result: { sum: 3 },
      molecules: [],
      structuredContent: 'not an object',
      _meta: ['not', 'an', 'object'],
    }),
  ).toStrictEqual({
    result: { sum: 3 },
    molecules: [],
    structuredContent: undefined,
    _meta: undefined,
  });
});

test('a resource listing keeps the fields of _meta.ui this version does not know', () => {
  const listing = {
    uri: 'ui://a/b',
    name: 'A view',
    mimeType: 'text/html;profile=mcp-app',
    version: '0123456789ab',
    _meta: {
      ui: { prefersBorder: true, future: 1 },
      'org.example/other': 2,
    },
  };

  expect(ResourceListSchema.parse({ resources: [listing] })).toStrictEqual({
    resources: [listing],
  });
});
