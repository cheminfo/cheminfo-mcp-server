import type { ViewManifest } from '../viewBuild.ts';

/**
 * A views build as Vite writes its manifest: an HTML entry importing a
 * vendor chunk (which imports React, which imports it back), a stylesheet
 * each, and OpenChemLib and a locale imported on demand.
 */
export const MANIFEST: ViewManifest = {
  'index.html': {
    file: 'assets/index-Bq3x9k2a.js',
    name: 'index',
    src: 'index.html',
    isEntry: true,
    imports: ['_vendor-D4fE5gH6.js'],
    dynamicImports: [
      'node_modules/openchemlib/dist/openchemlib.js',
      'node_modules/react-cheminfo/lib/locales/fr.json',
    ],
    css: ['assets/index-C7aB8cD9.css'],
  },
  '_vendor-D4fE5gH6.js': {
    file: 'assets/vendor-D4fE5gH6.js',
    name: 'vendor',
    imports: ['_react-K2m4n6p8.js'],
    css: ['assets/vendor-F0e1d2c3.css'],
  },
  '_react-K2m4n6p8.js': {
    file: 'assets/react-K2m4n6p8.js',
    name: 'react',
    imports: ['_vendor-D4fE5gH6.js'],
  },
  'node_modules/openchemlib/dist/openchemlib.js': {
    file: 'assets/openchemlib-Q9w8e7r6.js',
    name: 'openchemlib',
    src: 'node_modules/openchemlib/dist/openchemlib.js',
    isDynamicEntry: true,
  },
  'node_modules/react-cheminfo/lib/locales/fr.json': {
    file: 'assets/fr-KWC-k3fC.js',
    name: 'fr',
    isDynamicEntry: true,
  },
};

/**
 * A views build of one entry module, nothing else.
 */
export const ENTRY_ONLY: ViewManifest = {
  'main.tsx': { file: 'assets/main-1a2b.js', isEntry: true },
};
