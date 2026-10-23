import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ root: '' }));
vi.mock('../../../src/db/connection.js', () => ({ getDataDir: () => mocks.root }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename), link: vi.fn(actual.link) };
});
import { attachObjectCache, cleanupObjectCaches, preserveBorrowedObjects, repositoryCache } from '../../../src/workspace/object-cache.js';

const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const objects = (root: string) => join(root, '.git/objects');
const alternate = (root: string) => join(objects(root), 'info/alternates');
function repo(name: string, from?: string) {
  const root = join(mocks.root, 'workspaces', name); mkdirSync(dirname(root), { recursive: true });
  if (from) git(mocks.root, 'clone', '--quiet', '--shared', from, root);
  else {
    mkdirSync(root); git(root, 'init', '-q'); writeFileSync(join(root, 'file'), name); git(root, 'add', 'file');
    git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  }
  return root;
}
beforeEach(() => { mocks.root = realpathSync(mkdtempSync(join(tmpdir(), 'rev-object-cache-'))); });
afterEach(() => { vi.clearAllMocks(); rmSync(mocks.root, { recursive: true, force: true }); });

it('migrates a chain in either closure order, preserving relative alternates and collecting the whole graph', async () => {
  for (const order of ['provider-first', 'borrower-first']) {
    const provider = repo(`${order}-provider`), middle = repo(`${order}-middle`, provider), leaf = repo(`${order}-leaf`, middle);
    writeFileSync(alternate(middle), `${relative(objects(middle), objects(provider))}\n`);
    for (const root of order === 'provider-first' ? [provider, middle] : [middle, provider]) {
      await preserveBorrowedObjects(root); rmSync(root, { recursive: true }); await cleanupObjectCaches();
      expect(git(leaf, 'show', 'HEAD:file')).toBe(`${order}-provider`);
    }
    expect(readdirSync(join(mocks.root, 'git-cache'))).toHaveLength(2);
    rmSync(leaf, { recursive: true }); await cleanupObjectCaches();
    expect(readdirSync(join(mocks.root, 'git-cache'))).toEqual([]);
  }
});
it('keeps a partially published migration usable when a later atomic rewrite fails', async () => {
  const provider = repo('provider'), first = repo('first', provider), second = repo('second', provider);
  const rename = fs.rename;
  vi.mocked(rename).mockRejectedValueOnce(new Error('rename unavailable'));
  await expect(preserveBorrowedObjects(provider)).rejects.toThrow('rename unavailable');
  expect(git(first, 'show', 'HEAD:file')).toBe('provider'); expect(git(second, 'show', 'HEAD:file')).toBe('provider');
  vi.mocked(rename).mockImplementationOnce(async (from, to) => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    await actual.rename(from, to);
  }).mockRejectedValueOnce(new Error('second rewrite failed'));
  await expect(preserveBorrowedObjects(provider)).rejects.toThrow('second rewrite failed');
  await cleanupObjectCaches();
  expect(git(first, 'show', 'HEAD:file')).toBe('provider'); expect(git(second, 'show', 'HEAD:file')).toBe('provider');
  await preserveBorrowedObjects(provider); rmSync(provider, { recursive: true }); await cleanupObjectCaches();
  expect(git(first, 'show', 'HEAD:file')).toBe('provider'); expect(git(second, 'show', 'HEAD:file')).toBe('provider');
});
it('falls back to copying object bytes if hard links are unavailable', async () => {
  const provider = repo('provider'), borrower = repo('borrower', provider);
  vi.mocked(fs.link).mockRejectedValueOnce(Object.assign(new Error('different filesystem'), { code: 'EXDEV' }));
  await preserveBorrowedObjects(provider); rmSync(provider, { recursive: true });
  expect(git(borrower, 'show', 'HEAD:file')).toBe('provider');
});
it('keeps inherited user-clone dependencies read-only and never deletes the user clone', async () => {
  const user = join(mocks.root, 'user'); git(mocks.root, 'clone', '--quiet', repo('seed'), user);
  const provider = repo('provider', user), borrower = repo('borrower', provider);
  const config = readFileSync(join(user, '.git/config'), 'utf8');
  await preserveBorrowedObjects(provider); rmSync(provider, { recursive: true }); await cleanupObjectCaches();
  expect(git(borrower, 'show', 'HEAD:file')).toBe('seed');
  rmSync(borrower, { recursive: true }); await cleanupObjectCaches();
  expect(readFileSync(join(user, '.git/config'), 'utf8')).toBe(config); expect(git(user, 'show', 'HEAD:file')).toBe('seed');
});
it('initializes one shared cache concurrently and retains it until the last workspace disappears', async () => {
  const ref = { owner: 'example', repo: 'project', number: 1, url: '' };
  const [cache, same] = await Promise.all([repositoryCache(ref), repositoryCache({ ...ref, number: 2 })]);
  expect(cache).toBe(same); expect(git(cache, 'config', 'gc.auto')).toBe('0');
  const first = repo('first'), second = repo('second');
  await attachObjectCache(first, cache); await attachObjectCache(second, cache);
  await attachObjectCache(first, cache);
  expect(readFileSync(alternate(first), 'utf8').trim().split('\n')).toEqual([join(cache, 'objects')]);
  rmSync(first, { recursive: true }); await cleanupObjectCaches(); expect(existsSync(cache)).toBe(true);
  rmSync(second, { recursive: true }); await cleanupObjectCaches(); expect(existsSync(cache)).toBe(false);
  expect(await repositoryCache(ref)).toBe(cache); expect(git(cache, 'rev-parse', '--is-bare-repository')).toBe('true');
});
it('handles cycles without recursion loops and removes unreachable cycles', async () => {
  const root = repo('root');
  const first = await repositoryCache({ owner: 'example', repo: 'one', number: 1, url: '' });
  const second = await repositoryCache({ owner: 'example', repo: 'two', number: 1, url: '' });
  writeFileSync(join(first, 'objects/info/alternates'), `${join(second, 'objects')}\n`);
  writeFileSync(join(second, 'objects/info/alternates'), `${join(first, 'objects')}\n`);
  await attachObjectCache(root, first); await cleanupObjectCaches();
  expect(existsSync(first)).toBe(true); expect(existsSync(second)).toBe(true);
  rmSync(root, { recursive: true }); await cleanupObjectCaches();
  expect(existsSync(first)).toBe(false); expect(existsSync(second)).toBe(false);
});
it('fails safely on an unsafe cache or object path and leaves bytes outside managed storage intact', async () => {
  const outside = join(mocks.root, 'outside'); mkdirSync(outside); writeFileSync(join(outside, 'keep'), 'user data');
  symlinkSync(outside, join(mocks.root, 'git-cache'));
  await expect(cleanupObjectCaches()).rejects.toThrow('app-owned');
  rmSync(join(mocks.root, 'git-cache')); const root = repo('root');
  rmSync(objects(root), { recursive: true }); symlinkSync(outside, objects(root));
  await expect(preserveBorrowedObjects(root)).rejects.toThrow('Invalid workspace object directory');
  await expect(cleanupObjectCaches()).rejects.toThrow('Invalid workspace object directory');
  expect(readFileSync(join(outside, 'keep'), 'utf8')).toBe('user data');
});
