import { expect, test } from 'vitest';

import type { SandboxHistory, SandboxHistoryScope } from '../index.ts';
import { installSandboxHistory } from '../index.ts';

/**
 * A history refusing, as WebKit does in an opaque origin, any other path than
 * the page's own.
 * @param refuse - What it throws for another path, or for any address.
 * @returns The history, the changes it made, and the page's navigations.
 */
function sandboxedPage(refuse: () => unknown = () => blocked()) {
  const changes: string[] = [];
  const navigations: string[] = [];
  const change =
    (kind: string) =>
    (_data: unknown, _unused: string, url?: string | URL | null) => {
      const address = url === undefined || url === null ? '' : String(url);
      const path = new URL(address, 'https://3d.example/?smiles=CCCC').pathname;
      if (path !== '/') throw refuse();
      changes.push(`${kind} ${address}`);
    };
  const history: SandboxHistory = {
    pushState: change('push'),
    replaceState: change('replace'),
  };
  const scope: SandboxHistoryScope = {
    origin: 'null',
    history,
    location: {
      assign: (url) => {
        navigations.push(`assign ${url}`);
      },
      replace: (url) => {
        navigations.push(`replace ${url}`);
      },
    },
  };
  return { scope, history, changes, navigations };
}

function blocked() {
  return new DOMException(
    'Paths and fragments must match for a sandboxed document.',
    'SecurityError',
  );
}

test('in an opaque origin, a path the browser refuses is navigated to', () => {
  const { scope, history, changes, navigations } = sandboxedPage();
  installSandboxHistory(scope);
  const wrapped = history.pushState;
  installSandboxHistory(scope);

  expect(history.pushState).toBe(wrapped);

  history.replaceState(null, '', '/conformers?smiles=CCCC&embed=1');
  history.pushState({ step: 2 }, '', new URL('https://3d.example/fr/'));
  history.replaceState(null, '', '?smiles=CCO&embed=1');
  history.pushState(null, '', '#torsions');
  history.pushState(null, '');

  expect(navigations).toStrictEqual([
    'replace /conformers?smiles=CCCC&embed=1',
    'assign https://3d.example/fr/',
  ]);
  expect(changes).toStrictEqual([
    'replace ?smiles=CCO&embed=1',
    'push #torsions',
    'push ',
  ]);
});

test('another error of the history is thrown as it is', () => {
  const { scope, history, navigations } = sandboxedPage(
    () => new DOMException('The state cannot be cloned.', 'DataCloneError'),
  );
  installSandboxHistory(scope);

  expect(() => history.pushState(null, '', '/conformers')).toThrow(
    'The state cannot be cloned.',
  );

  const refusing = sandboxedPage();
  refusing.history.replaceState = () => {
    throw blocked();
  };
  installSandboxHistory(refusing.scope);

  expect(() => refusing.history.replaceState(null, '')).toThrow(
    'Paths and fragments must match for a sandboxed document.',
  );
  expect([...navigations, ...refusing.navigations]).toStrictEqual([]);
});

test('a page with an origin of its own keeps its history as it is', () => {
  const own = sandboxedPage();
  own.scope.origin = 'https://3d.example';
  const original = own.history.replaceState;
  installSandboxHistory(own.scope);

  expect(own.history.replaceState).toBe(original);
  expect(() => own.history.replaceState(null, '', '/conformers')).toThrow(
    'Paths and fragments must match for a sandboxed document.',
  );

  const noLocation = sandboxedPage();
  delete noLocation.scope.location;
  const kept = noLocation.history.pushState;
  installSandboxHistory(noLocation.scope);

  expect(noLocation.history.pushState).toBe(kept);
});
