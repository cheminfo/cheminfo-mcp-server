import { expect, test } from 'vitest';

import { additionTool, benzeneTool } from '../../__tests__/sampleTools.ts';
import { buildToolCatalog } from '../catalog.ts';

test('the catalog offers each strict schema with read-only annotations, and its version follows its content', async () => {
  const catalog = await buildToolCatalog([additionTool], 'Add numbers.');
  const same = await buildToolCatalog([additionTool], 'Add numbers.');
  const other = await buildToolCatalog(
    [additionTool, benzeneTool],
    'Add numbers.',
  );

  expect(catalog).toStrictEqual({
    version: same.version,
    instructions: 'Add numbers.',
    tools: [
      {
        name: 'addNumbers',
        title: 'Add two numbers',
        description: 'Add two numbers.',
        inputSchema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          properties: { a: { type: 'number' }, b: { type: 'number' } },
          required: ['a', 'b'],
          additionalProperties: false,
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
    ],
  });
  expect(catalog.version).toMatch(/^[\da-f]{12}$/);
  expect(other.version).not.toBe(catalog.version);
});
