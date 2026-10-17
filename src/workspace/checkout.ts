import { execFile } from 'node:child_process';
import { appendFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { PullTab } from '../api/workspace.js';
import { getDataDir } from '../db/connection.js';
import { addReviewFile, createReview, updateReviewSource } from '../db/queries.js';
import { parseDiff } from '../git/parseDiff.js';
import { updateReviewDiffs } from '../review-update.js';
import { githubToken } from './github.js';
import { workspaceData } from './storage.js';

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
    const { stdout } = await exec('git', args, {
      cwd, env: env ?? process.env, timeout: 180000, maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  };
  if (args[0] !== 'fetch') return run();
  // Imports sharing an object store must not race Git's shallow/FETCH_HEAD locks.
  const pending = (fetches.get(cwd) ?? Promise.resolve()).catch(() => {}).then(run);
  fetches.set(cwd, pending);
  try { return await pending; }
  finally { if (fetches.get(cwd) === pending) fetches.delete(cwd); }
}
/** Import into a dedicated checkout; never switch the user's existing working tree. */
export async function importPull(tab: PullTab): Promise<void> {
  const info = tab.info;
  if (!info) throw new Error('PR details are unavailable');
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
    tab.repoRoot ??
    workspaceData().tabs.find(
      (other) =>
        other.ref.owner === tab.ref.owner && other.ref.repo === tab.ref.repo && other.repoRoot !== null,
    )?.repoRoot;
  if (source !== undefined && source !== null && source !== root) {
    const objects = (
      await gitAsync(['rev-parse', '--path-format=absolute', '--git-path', 'objects'], source)
    ).trim();
    await writeFile(join(root, '.git', 'objects', 'info', 'alternates'), `${await realpath(objects)}\n`);
  }
  const env = await gitAuthEnv(tab);
  const available = await Promise.all([info.baseRefOid, info.headRefOid].map(sha =>
    gitAsync(['cat-file', '-e', `${sha}^{commit}`], root).then(() => true, () => false)));
  // Fetch through an existing checkout so Git can negotiate its known history.
  const fetchRoot = source ?? root;
  if (!available.every(Boolean)) await gitAsync(
    [
      'fetch',
      '--no-tags',
      ...(fetchRoot === root ? ['--depth=100'] : []),
      `https://github.com/${tab.ref.owner}/${tab.ref.repo}.git`,
      // Keep borrowed commits reachable when the shared object store runs GC.
      ...[...new Set([info.baseRefOid, info.headRefOid])].map(sha => `${sha}:refs/glassbox/cache/${sha}`),
    ],
    fetchRoot,
    env,
  );
  if (fetchRoot !== root) {
    const shallow = (await gitAsync(['rev-parse', '--path-format=absolute', '--git-path', 'shallow'], fetchRoot)).trim();
    try { await writeFile(join(root, '.git', 'shallow'), await readFile(shallow)); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  }
  const dirty = await gitAsync(['status', '--porcelain'], root);
  if (dirty.trim()) throw new Error('The managed checkout has local changes; they were preserved.');
  await gitAsync(['checkout', '--detach', info.headRefOid], root);
  let base: string;
  try {
    base = (await gitAsync(['merge-base', info.baseRefOid, info.headRefOid], root)).trim();
  } catch {
    await gitAsync(
      [
        'fetch',
        '--deepen=1000',
        `https://github.com/${tab.ref.owner}/${tab.ref.repo}.git`,
        info.baseRefOid,
        info.headRefOid,
      ],
      root,
      env,
    );
    base = (await gitAsync(['merge-base', info.baseRefOid, info.headRefOid], root)).trim();
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
}
