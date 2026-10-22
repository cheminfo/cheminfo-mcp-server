import { expect, test } from 'vitest';

import { EMBED_META_KEY, embedMeta, embedView } from '../embedView.ts';

test('the view frames the site and nothing else, and passes on the clipboard', () => {
  const { html, ...view } = embedView({
    uri: 'ui://equilibrium/page',
    name: 'equilibrium.cheminfo.org',
    origins: ['https://equilibrium.cheminfo.org', 'http://localhost:10602'],
    description: 'Titration curves and the pH of solutions',
  });

  expect(view).toStrictEqual({
    uri: 'ui://equilibrium/page',
    name: 'equilibrium.cheminfo.org',
    description: 'Titration curves and the pH of solutions',
    csp: {
      frameDomains: [
        'https://equilibrium.cheminfo.org',
        'http://localhost:10602',
      ],
    },
    permissions: { clipboardWrite: {} },
    prefersBorder: true,
  });
  expect(html).toContain(
    '"origins":["https://equilibrium.cheminfo.org","http://localhost:10602"]',
  );
  expect(html).toContain('"height":640');
  expect(html).toContain(
    '<iframe id="card" title="equilibrium.cheminfo.org" allow="fullscreen *; clipboard-write *" hidden></iframe>',
  );
  expect(html).toContain("'ui/initialize'");
  expect(html).toContain("'ui/notifications/tool-result'");
  expect(html).toContain('<title>equilibrium.cheminfo.org</title>');
});

test('a view without a description lists none', () => {
  const { html, ...view } = embedView({
    uri: 'ui://x/page',
    name: 'x.example',
    origins: ['https://x.example'],
  });

  expect(view).toStrictEqual({
    uri: 'ui://x/page',
    name: 'x.example',
    csp: { frameDomains: ['https://x.example'] },
    permissions: { clipboardWrite: {} },
    prefersBorder: true,
  });
  expect(typeof html).toBe('string');
});

test('a name cannot close the script or the markup it is written into', () => {
  const name = '</script><b>"x"</b>';
  const html = embedView({
    uri: 'ui://x/page',
    name,
    origins: ['https://x.example'],
    height: 400,
  }).html as string;
  const settings = /const settings = (?<json>\{.*\});/.exec(html)?.groups?.json;

  expect(html).toContain(
    '<title>&lt;/script&gt;&lt;b&gt;&quot;x&quot;&lt;/b&gt;</title>',
  );
  expect(html.match(/<\/script>/g)).toHaveLength(1);
  expect(JSON.parse(settings ?? '{}')).toMatchObject({ name, height: 400 });
});

test('an answer carries the page its view frames', () => {
  expect(
    embedMeta('https://equilibrium.cheminfo.org/ph?acid=HCl&embed=1'),
  ).toStrictEqual({
    [EMBED_META_KEY]: {
      url: 'https://equilibrium.cheminfo.org/ph?acid=HCl&embed=1',
    },
  });
  expect(EMBED_META_KEY).toBe('org.cheminfo/embed');
});

test('an answer carries its card and the full page beside it', () => {
  expect(
    embedMeta('https://x.example/ph?embed=1&card=1', {
      page: 'https://x.example/ph?embed=1',
    }),
  ).toStrictEqual({
    [EMBED_META_KEY]: {
      url: 'https://x.example/ph?embed=1&card=1',
      page: 'https://x.example/ph?embed=1',
    },
  });
});
