import type { ViewAssets } from './viewBuild.ts';

/**
 * The name of the loader, the one asset whose name never changes.
 */
export const VIEW_LOADER_FILE = 'loader.js';

/**
 * How the loader is cached: asked again every time, so a page a host keeps
 * always loads the current build.
 */
export const VIEW_LOADER_CACHE_CONTROL = 'no-cache';

/**
 * The loader of a views build: a module, served beside the assets under a
 * name that never changes, that adds the build's stylesheets and preloads,
 * then imports its hashed entry. A view's page that loads it keeps working
 * after a deploy removes the files it named, however long a host kept it.
 * @param assets - What the build's page loads.
 * @returns The module's source.
 */
export function viewLoaderScript(assets: ViewAssets): string {
  return [
    "const base = new URL('./', import.meta.url);",
    'const add = (rel, file) => {',
    "  const link = document.createElement('link');",
    '  link.rel = rel;',
    "  link.crossOrigin = '';",
    '  link.href = new URL(file, base).href;',
    '  document.head.append(link);',
    '};',
    `for (const file of ${list(assets.styles)}) add('stylesheet', file);`,
    `for (const file of ${list(assets.preloads)}) add('modulepreload', file);`,
    `await import(new URL(${name(assets.script)}, base).href);`,
    '',
  ].join('\n');
}

/**
 * A file of the build as a string literal of the loader, beside which it is
 * served.
 * @param file - The file, relative to the views build (`assets/…`).
 * @returns Its name, as a JavaScript string.
 */
function name(file: string): string {
  return JSON.stringify(file.slice('assets/'.length));
}

/**
 * Files of the build as an array literal of the loader.
 * @param files - The files, relative to the views build.
 * @returns Their names, as a JavaScript array.
 */
function list(files: string[]): string {
  return `[${files.map(name).join(', ')}]`;
}
