import { execFile } from 'node:child_process';
import { appendFile, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { z } from 'zod';

import type { PullTab } from '../api/workspace.js';
import { getDataDir } from '../db/connection.js';
import { addReviewFile, createReview, updateReviewSource } from '../db/queries.js';
import { parseDiff } from '../git/parseDiff.js';
import { updateReviewDiffs } from '../review-update.js';
import { github, githubToken, repoApi } from './github.js';
import { withCheckoutLock } from './lifecycle.js';
import { findLocalRepository } from './repositories.js';
import { saveWorkspace, workspaceData } from './storage.js';

const exec = promisify(execFile);
const fetches = new Map<string, Promise<string>>();
export async function gitAuthEnv(tab: Pick<PullTab, 'ref'>): Promise<NodeJS.ProcessEnv> {
  const token = await githubToken(tab.ref);
  return { ...process.env, GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}` };
}
export async function gitAsync(args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<string> {
  const run = async () => {
    try {
      const { stdout } = await exec('git', args, {
        cwd, env: env ?? process.env, timeout: 180000, maxBuffer: 64 * 1024 * 1024,
      });
      return stdout;
    } catch (error) {
      if (error instanceof Error && 'killed' in error && error.killed === true)
        throw new Error(`Git ${args[0]} timed out after three minutes. Retry to continue loading the source.`, { cause: error });
      throw error;
    }
  };
  if (args[0] !== 'fetch') return run();
  // Imports sharing an object store must not race Git's shallow/FETCH_HEAD locks.
  const pending = (fetches.get(cwd) ?? Promise.resolve()).catch(() => {}).then(run);
  fetches.set(cwd, pending);
  try { return await pending; }
  finally { if (fetches.get(cwd) === pending) fetches.delete(cwd); }
}
async function remoteMergeBase(tab: PullTab): Promise<string> {
  const info = tab.info;
  if (!info) throw new Error('PR details are unavailable');
  const result = z.object({ merge_base_commit: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }) })
    .parse(await github(tab.ref, `${repoApi(tab.ref)}/compare/${info.baseRefOid}...${info.headRefOid}?per_page=1`));
  return result.merge_base_commit.sha;
}
/** Import into a dedicated checkout; never switch the user's existing working tree. */
export async function importPull(tab: PullTab): Promise<void> {
  return withCheckoutLock(tab.key, () => prepareCheckout(tab, false));
}

const restoring = new Map<string, Promise<void>>();
/** Recreate the exact saved source snapshot without rewriting review files or annotations. */
export async function ensureCheckout(tab: PullTab): Promise<void> {
  if (!tab.checkoutEvicted) return;
  const existing = restoring.get(tab.key);
  if (existing) return existing;
  const pending = withCheckoutLock(tab.key, async () => {
    if (!tab.checkoutEvicted) return;
    tab.loading = true;
    tab.error = undefined;
    tab.lastUsedAt = Date.now();
    saveWorkspace();
    try {
      await prepareCheckout(tab, true);
      tab.error = undefined;
    } catch (error) {
      tab.error = error instanceof Error ? error.message : 'Could not restore the review checkout';
      throw error;
    } finally { tab.loading = false; saveWorkspace(); }
  });
  restoring.set(tab.key, pending);
  try { await pending; }
  finally { if (restoring.get(tab.key) === pending) restoring.delete(tab.key); }
}

async function prepareCheckout(tab: PullTab, restore: boolean): Promise<void> {
  const info = tab.info;
  if (!info) throw new Error('PR details are unavailable');
  const head = restore ? tab.reviewedHead : info.headRefOid;
  const target = restore ? tab.reviewedBase : info.baseRefOid;
  if (!head || !target) throw new Error('The saved PR revision is unavailable; refresh the PR');
  const root = join(
    getDataDir() ??
      (() => {
        throw new Error('Storage unavailable');
      })(),
    'workspaces',
    `${tab.ref.owner}-${tab.ref.repo}-${tab.ref.number}`,
  );
  await mkdir(root, { recursive: true });
  await gitAsync(['init', '--quiet'], root);
  const exclude = join(root, '.git', 'info', 'exclude');
  if (!(await readFile(exclude, 'utf8')).split('\n').includes('/.glassbox/'))
    await appendFile(exclude, '\n/.glassbox/\n');
  const source =
    (!tab.checkoutEvicted ? tab.repoRoot : null) ??
    workspaceData().tabs.find(
      (other) =>
        other.key !== tab.key && !other.checkoutEvicted && other.ref.owner === tab.ref.owner && other.ref.repo === tab.ref.repo && other.repoRoot !== null,
    )?.repoRoot ?? await findLocalRepository(tab.ref);
  if (source !== undefined && source !== root) {
    const objects = (
      await gitAsync(['rev-parse', '--path-format=absolute', '--git-path', 'objects'], source)
    ).trim();
    await writeFile(join(root, '.git', 'objects', 'info', 'alternates'), `${await realpath(objects)}\n`);
  }
  const env = await gitAuthEnv(tab);
  // Fetch through an existing checkout so Git can negotiate its known history.
  const fetchRoot = source ?? root;
  // A cold clone needs two snapshots, not an arbitrary window of commit history.
  let base = restore ? target : source !== undefined ? undefined : await remoteMergeBase(tab);
  const commits = [...new Set([target, head, ...(base !== undefined ? [base] : [])])];
  const available = await Promise.all(commits.map(sha =>
    gitAsync(['cat-file', '-e', `${sha}^{commit}`], root).then(() => true, () => false)));
  if (!available.every(Boolean)) await gitAsync(
    [
      'fetch',
      '--no-tags',
      ...(source === undefined ? ['--depth=1'] : []),
      `https://github.com/${tab.ref.owner}/${tab.ref.repo}.git`,
      // Keep borrowed commits reachable when the shared object store runs GC.
      ...commits.map(sha => `${sha}:refs/glassbox/cache/${sha}`),
    ],
    fetchRoot,
    env,
  );
  if (fetchRoot !== root) {
    const shallow = (await gitAsync(['rev-parse', '--path-format=absolute', '--git-path', 'shallow'], fetchRoot)).trim();
    try { await writeFile(join(root, '.git', 'shallow'), await readFile(shallow)); }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      await rm(join(root, '.git', 'shallow'), { force: true });
    }
    // Even a network-free import must protect borrowed commits from source-repo GC.
    for (const sha of commits) await gitAsync(['update-ref', `refs/glassbox/cache/${sha}`, sha], fetchRoot);
  }
  const dirty = await gitAsync(['status', '--porcelain'], root);
  if (dirty.trim()) throw new Error('The managed checkout has local changes; they were preserved.');
  await gitAsync(['checkout', '--detach', head], root);
  if (restore) {
    tab.repoRoot = root;
    tab.checkoutEvicted = false;
    return;
  }
  try {
    base ??= (await gitAsync(['merge-base', info.baseRefOid, info.headRefOid], root)).trim();
  } catch {
    base = await remoteMergeBase(tab);
    try { await gitAsync(['cat-file', '-e', `${base}^{commit}`], root); }
    catch {
      await gitAsync(['fetch', '--no-tags', '--depth=1', `https://github.com/${tab.ref.owner}/${tab.ref.repo}.git`,
        `${base}:refs/glassbox/cache/${base}`], root, env);
    }
  }
  const diff = await gitAsync(['diff', '--no-ext-diff', '--find-renames', base, info.headRefOid, '--'], root);
  if (tab.reviewId === null) {
    const review = await createReview(
      root,
      tab.ref.repo,
      `range:${base}..${info.headRefOid}`,
      `${base}..${info.headRefOid}`,
      info.headRefOid,
    );
    for (const file of parseDiff(diff)) await addReviewFile(review.id, file.filePath, JSON.stringify(file));
    tab.reviewId = review.id;
  } else {
    await updateReviewDiffs(tab.reviewId, parseDiff(diff), info.headRefOid);
    await updateReviewSource(tab.reviewId, root, base, info.headRefOid);
  }
  tab.repoRoot = root;
  tab.reviewedHead = info.headRefOid;
  tab.reviewedBase = base;
  tab.checkoutEvicted = false;
  tab.lastUsedAt = Date.now();
}
