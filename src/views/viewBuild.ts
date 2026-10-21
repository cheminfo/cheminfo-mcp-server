import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

const ManifestChunk = z.looseObject({
  file: z.string(),
  name: z.string().optional(),
  src: z.string().optional(),
  isEntry: z.boolean().optional(),
  imports: z.array(z.string()).optional(),
  dynamicImports: z.array(z.string()).optional(),
  css: z.array(z.string()).optional(),
});

const ViewManifestSchema = z.record(z.string(), ManifestChunk);

/**
 * The Vite manifest of a views build: its chunks, by name.
 */
export type ViewManifest = z.output<typeof ViewManifestSchema>;

/**
 * The files a view's page loads, relative to the views build.
 */
export interface ViewAssets {
  /**
   * The app's entry module.
   */
  script: string;
  /**
   * The stylesheets of the entry and of the modules it imports.
   */
  styles: string[];
  /**
   * The modules fetched at once: those the entry imports, and those of the
   * chunks it imports on demand that are preloaded.
   */
  preloads: string[];
}

/**
 * A views build, checked: its manifest and what its page loads.
 */
export interface ViewBuild {
  manifest: ViewManifest;
  assets: ViewAssets;
}

/**
 * Options of {@link readViewBuild} and {@link viewAssets}.
 */
export interface ViewBuildOptions {
  /**
   * The names of the chunks the entry imports on demand that its page
   * fetches at once, e.g. OpenChemLib, which draws every structure.
   * @default ['openchemlib']
   */
  preload?: readonly string[];
}

/**
 * A file of the build's flat assets folder, never a path out of it.
 */
const ASSET_FILE = /^assets\/[\w-][\w.-]*$/;

/**
 * Read a views build: its Vite manifest, where Vite writes it by default
 * (`.vite/manifest.json`) else at the build's root (`manifest.json`), and
 * the files its page loads.
 * @param root - The views build's folder.
 * @param options - The chunks imported on demand to fetch at once.
 * @returns The build, or undefined while the views are not built.
 * @throws {Error} When the manifest cannot be read, is not a Vite manifest,
 *   or names a build its page cannot load.
 */
export async function readViewBuild(
  root: string,
  options: ViewBuildOptions = {},
): Promise<ViewBuild | undefined> {
  const text =
    (await readIfThere(join(root, '.vite', 'manifest.json'))) ??
    (await readIfThere(join(root, 'manifest.json')));
  if (text === undefined) return undefined;
  const manifest = ViewManifestSchema.parse(JSON.parse(text));
  return { manifest, assets: viewAssets(manifest, options) };
}

/**
 * The files a view's page loads: the build's one entry module, the modules
 * it imports statically and their stylesheets, each once, and the chunks it
 * imports on demand that `preload` names.
 * @param manifest - The views build's manifest.
 * @param options - The chunks imported on demand to fetch at once.
 * @returns The files, relative to the views build.
 * @throws {Error} When the build has no entry or several, a chunk is
 *   missing, or a file is outside its assets folder.
 */
export function viewAssets(
  manifest: ViewManifest,
  options: ViewBuildOptions = {},
): ViewAssets {
  const preload = new Set(options.preload ?? ['openchemlib']);
  const entries = Object.entries(manifest).filter(
    ([, chunk]) => chunk.isEntry === true,
  );
  const [first] = entries;
  if (first === undefined || entries.length > 1) {
    throw new Error(
      `The views build has ${entries.length} entries; the view loads exactly one.`,
    );
  }
  const [name, entry] = first;
  const found: FoundAssets = {
    styles: new Set(),
    preloads: new Set(),
    seen: new Set([name]),
  };
  collectAssets(manifest, entry, found);
  const onDemand = entry.dynamicImports ?? [];
  for (const imported of onDemand) {
    const chunk = manifest[imported];
    if (chunk?.name !== undefined && preload.has(chunk.name)) {
      found.preloads.add(assetFile(chunk.file));
    }
  }
  return {
    script: assetFile(entry.file),
    styles: [...found.styles],
    preloads: [...found.preloads],
  };
}

/**
 * What collectAssets() gathers.
 */
interface FoundAssets {
  styles: Set<string>;
  preloads: Set<string>;
  /**
   * The chunks already visited, by name.
   */
  seen: Set<string>;
}

/**
 * Gather a chunk's stylesheets, then each chunk it imports statically and
 * what that one imports, each chunk once.
 * @param manifest - The views build's manifest.
 * @param chunk - The chunk.
 * @param found - What was gathered so far; completed in place.
 * @throws {Error} When an imported chunk is missing or a file is outside
 *   the assets folder.
 */
function collectAssets(
  manifest: ViewManifest,
  chunk: ViewManifest[string],
  found: FoundAssets,
): void {
  const { css = [], imports = [] } = chunk;
  for (const style of css) found.styles.add(assetFile(style));
  for (const imported of imports) {
    if (found.seen.has(imported)) continue;
    found.seen.add(imported);
    const next = manifest[imported];
    if (next === undefined) {
      throw new Error(`The views manifest has no chunk "${imported}".`);
    }
    found.preloads.add(assetFile(next.file));
    collectAssets(manifest, next, found);
  }
}

/**
 * Check that a file of the manifest is in the build's flat assets folder,
 * the only one registerViewAssets() serves.
 * @param file - The file, relative to the views build.
 * @returns The file.
 * @throws {Error} When it is anywhere else.
 */
function assetFile(file: string): string {
  if (!ASSET_FILE.test(file) || file.includes('..')) {
    throw new Error(
      `The views build names a file outside its assets folder: ${JSON.stringify(file)}.`,
    );
  }
  return file;
}

/**
 * A text file's content, if the file is there.
 * @param path - The file.
 * @returns The text, or undefined when there is no such file.
 * @throws {Error} When it is there but cannot be read.
 */
async function readIfThere(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
