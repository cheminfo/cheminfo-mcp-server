import { expect, test } from 'vitest';

import type { OpenedWindow, SitePageScope } from '../index.ts';
import { EMBED_EXPAND_MESSAGE, openSitePage } from '../index.ts';

const PAGE = 'https://lcao.example/playground?smiles=NC%3DO';

function framedScope(opened: OpenedWindow | null) {
  const posted: unknown[] = [];
  const asked: Array<[string, string]> = [];
  const scope: SitePageScope = {
    parent: {
      postMessage: (message) => {
        posted.push(message);
      },
    },
    open: (url, target) => {
      asked.push([url, target]);
      return opened;
    },
  };
  return { scope, posted, asked };
}

test('framed, the page opens in a new window whose opener is cleared', () => {
  const opened: OpenedWindow = { opener: 'the card' };
  const { scope, posted, asked } = framedScope(opened);

  expect(openSitePage(PAGE, scope)).toBe('window');
  expect(asked).toStrictEqual([[PAGE, '_blank']]);
  expect(opened.opener).toBeNull();
  expect(posted).toStrictEqual([]);
});

test('a refused window asks the view for the full page instead', () => {
  const { scope, posted, asked } = framedScope(null);

  expect(openSitePage(PAGE, scope)).toBe('full-screen');
  expect(asked).toStrictEqual([[PAGE, '_blank']]);
  expect(posted).toStrictEqual([{ type: EMBED_EXPAND_MESSAGE }]);
});

test('a page that is not framed goes to the site page itself', () => {
  const assigned: string[] = [];
  const scope: SitePageScope = {
    location: {
      assign: (url) => {
        assigned.push(url);
      },
    },
  };
  scope.parent = scope as unknown as SitePageScope['parent'];

  expect(openSitePage(PAGE, scope)).toBe('here');
  expect(assigned).toStrictEqual([PAGE]);
  expect(openSitePage(PAGE, {})).toBe('here');
});
