import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, link, lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { PullRef } from '../api/workspace.js';
import { getDataDir } from '../db/connection.js';
import { gitAsync } from './checkout.js';
import { withCheckoutLock } from './lifecycle.js';

const cacheName = /^(?:[a-f0-9]{64}|legacy-[a-f0-9-]{36})$/;
async function cacheRoot(): Promise<string> {
  const data = getDataDir();
  if (data === null) throw new Error('Storage unavailable');
  const root = join(data, 'git-cache');
  await mkdir(root, { recursive: true });
  if (!(await lstat(root)).isDirectory() || await realpath(root) !== join(await realpath(data), 'git-cache'))
    throw new Error('Git cache must be an app-owned directory');
  return await realpath(root);
}
async function caches(): Promise<string[]> {
  const root = await cacheRoot();
  return (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory() && cacheName.test(entry.name))
    .map(entry => join(root, entry.name));
}
/** A stable bare repository shares snapshots without depending on any PR checkout. */
export async function repositoryCache(ref: PullRef): Promise<string> {
  const key = createHash('sha256').update(`${ref.owner}/${ref.repo}`.toLowerCase()).digest('hex');
  const root = join(await cacheRoot(), key);
  return withCheckoutLock(`cache:${root}`, async () => {
    await mkdir(root, { recursive: true });
    if (!(await lstat(root)).isDirectory() || await realpath(root) !== root) throw new Error('Invalid Git cache path');
    await gitAsync(['init', '--bare', '--quiet'], root);
    await gitAsync(['config', 'gc.auto', '0'], root);
    return root;
  });
}
async function objectDirectories(): Promise<string[]> {
  const data = getDataDir();
  if (data === null) throw new Error('Storage unavailable');
  const area = join(await realpath(data), 'workspaces');
  if (await realpath(area).catch(() => area) !== area) throw new Error('Invalid workspace directory');
  const entries = await readdir(area, { withFileTypes: true }).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  });
  const result: string[] = [];
  for (const entry of entries) if (entry.isDirectory()) {
    const objects = join(area, entry.name, '.git', 'objects');
    try {
      if (await realpath(objects) !== objects) throw new Error('Invalid workspace object directory');
      result.push(objects);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }
  return result;
}
async function alternates(objects: string): Promise<string[]> {
  try {
    return (await readFile(join(objects, 'info', 'alternates'), 'utf8')).split('\n').filter(Boolean)
      .map(path => resolve(objects, path));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}
async function setAlternates(objects: string, paths: string[]): Promise<void> {
  await mkdir(join(objects, 'info'), { recursive: true });
  const path = join(objects, 'info', 'alternates'), temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, `${paths.join('\n')}\n`, { mode: 0o600 }); await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}
/** Preserve legacy alternates until their provider is migrated; new checkouts use only this cache. */
export async function attachObjectCache(root: string, cache: string): Promise<void> {
  const objects = join(root, '.git', 'objects');
  await setAlternates(objects, [...new Set([join(cache, 'objects'), ...await alternates(objects)])]);
}
/** Git object files are immutable: links retain their bytes without packing or copying history. */
async function retainObjects(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name), to = join(target, entry.name);
    if (entry.isDirectory()) await retainObjects(from, to);
    else if (entry.isFile()) {
      // alternates is mutable metadata; never share its inode with a live checkout.
      if (entry.name === 'alternates') await copyFile(from, to);
      else try { await link(from, to); }
      catch (error) {
        if (!(error instanceof Error && 'code' in error && ['EXDEV', 'EPERM', 'ENOTSUP'].includes(String(error.code)))) throw error;
        await copyFile(from, to, constants.COPYFILE_FICLONE);
      }
    } else throw new Error('Cannot retain a Git object store containing symlinks or special files');
  }
}
/** Caller holds the storage write lock. No Git command runs on dependent repositories. */
export async function preserveBorrowedObjects(root: string): Promise<void> {
  const objects = join(await realpath(root), '.git', 'objects');
  if (await realpath(objects) !== objects) throw new Error('Invalid workspace object directory');
  const borrowers: Array<{ objects: string; paths: string[] }> = [];
  for (const other of [...await objectDirectories(), ...(await caches()).map(cache => join(cache, 'objects'))]) {
    if (other === objects) continue;
    const paths = await alternates(other);
    const resolved = await Promise.all(paths.map(path => realpath(path).catch(() => path)));
    if (resolved.includes(objects)) borrowers.push({ objects: other, paths: paths.map((path, index) => resolved[index] === objects ? objects : path) });
  }
  if (!borrowers.length) return;
  const cache = join(await cacheRoot(), `legacy-${randomUUID()}`), retained = join(cache, 'objects');
  let published = false;
  try {
    await retainObjects(objects, retained);
    const inherited = await alternates(objects);
    if (inherited.length) await setAlternates(retained, inherited);
    published = true;
    for (const borrower of borrowers) {
      await setAlternates(borrower.objects, borrower.paths.map(path => path === objects ? retained : path));
    }
  } catch (error) {
    // A partial migration must keep any cache already referenced by another checkout.
    if (!published) await rm(cache, { recursive: true, force: true });
    throw error;
  }
}
/** Caller holds the storage write lock. Keep the complete dependency graph, not closed-tab records. */
export async function cleanupObjectCaches(): Promise<void> {
  const stores = await caches(), reachable = new Set<string>(), visited = new Set<string>();
  const visit = async (path: string): Promise<void> => {
    const objects = await realpath(path).catch(() => path);
    if (visited.has(objects)) return;
    visited.add(objects);
    for (const cache of stores) if (objects === join(cache, 'objects')) reachable.add(cache);
    for (const dependency of await alternates(objects)) await visit(dependency);
  };
  for (const root of await objectDirectories()) await visit(root);
  for (const cache of stores) if (!reachable.has(cache)) await rm(cache, { recursive: true });
}
