import { constants } from 'node:fs';
import {
  copyFile,
  mkdir,
  readdir,
  stat,
  unlink,
  utimes,
} from 'node:fs/promises';
import { join } from 'node:path';

/**
 * An asset's name: no dotfile, nothing that leaves the folder.
 */
const ASSET_NAME = /^[\w-][\w.-]*$/;

/**
 * Keep a build's assets beside those of earlier builds: copy each file of
 * the current build into `retainDirectory` unless it is there already, and
 * mark it as current (its modification time), then delete the retained
 * files no build has had for `retainDays` days. Hashed names never change
 * their content, so a file already there is never rewritten.
 * @param current - The current build's assets folder; nothing is copied
 *   while it does not exist.
 * @param retainDirectory - The folder that keeps them; created when missing.
 * @param retainDays - Days a file the current build no longer has is kept.
 */
export async function retainAssets(
  current: string,
  retainDirectory: string,
  retainDays: number,
): Promise<void> {
  await mkdir(retainDirectory, { recursive: true });
  const files = new Set(await filesOf(current));
  const now = new Date();
  await Promise.all(
    Array.from(files, (file) =>
      retainFile(join(current, file), join(retainDirectory, file), now),
    ),
  );
  const oldest = Date.now() - retainDays * 86_400_000;
  const retained = await filesOf(retainDirectory);
  await Promise.all(
    retained
      .filter((file) => !files.has(file))
      .map((file) => removeIfOlder(join(retainDirectory, file), oldest)),
  );
}

/**
 * Copy a file unless its copy is there, then mark the copy as current.
 * @param source - The build's file.
 * @param target - Its retained copy.
 * @param now - The time it is marked with.
 */
async function retainFile(
  source: string,
  target: string,
  now: Date,
): Promise<void> {
  try {
    await copyFile(source, target, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  await utimes(target, now, now);
}

/**
 * Delete a retained file no build has had since a time.
 * @param path - The file.
 * @param oldest - Epoch ms: a file last marked before it is deleted.
 */
async function removeIfOlder(path: string, oldest: number): Promise<void> {
  const { mtimeMs } = await stat(path);
  if (mtimeMs < oldest) await unlink(path);
}

/**
 * The assets of a folder: its plain files, dotfiles left out.
 * @param folder - The folder.
 * @returns Their names; none when the folder does not exist.
 */
async function filesOf(folder: string): Promise<string[]> {
  try {
    const entries = await readdir(folder, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (entry.isFile() && ASSET_NAME.test(entry.name)) {
        names.push(entry.name);
      }
    }
    return names;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
