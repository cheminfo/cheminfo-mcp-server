import { expect, test } from 'vitest';

import { toCallToolResult, toErrorCallToolResult } from '../index.ts';

test('a JSON answer becomes the result MCP gives: the result as text, each file, structuredContent and _meta', () => {
  expect([
    toCallToolResult({ result: { sum: 3 }, molecules: [] }),
    toCallToolResult({
      result: { name: 'methane' },
      molecules: [{ smiles: 'C' }],
      files: [
        { fileName: 'methane.mol', format: 'molfile', content: 'M  END' },
      ],
      structuredContent: { atoms: 1 },
      _meta: { 'org.example/view': { view: 'molecule' } },
    }),
  ]).toStrictEqual([
    { content: [{ type: 'text', text: '{\n  "sum": 3\n}' }] },
    {
      content: [
        { type: 'text', text: '{\n  "name": "methane"\n}' },
        { type: 'text', text: 'M  END' },
      ],
      structuredContent: { atoms: 1 },
      _meta: { 'org.example/view': { view: 'molecule' } },
    },
  ]);
});

test('a refusal becomes an error result', () => {
  expect(toErrorCallToolResult('The copy is loading.')).toStrictEqual({
    content: [{ type: 'text', text: 'The copy is loading.' }],
    isError: true,
  });
});
