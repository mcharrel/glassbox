import { lstat, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import { markAnalysisCanceled } from '../ai/analysis-pipeline.js';
import type { PullTab } from '../api/workspace.js';
import { getDataDir, getDb } from '../db/connection.js';
import { deleteReview, getReview } from '../db/queries.js';
import { deleteReviewExport } from '../export/generate.js';
import { gitAsync } from './checkout.js';
import { cleanupObjectCaches, preserveBorrowedObjects } from './object-cache.js';
import { managedPath, safeHead } from './retention.js';
import { saveWorkspace, workspaceData } from './storage.js';

async function ownedPath(area: 'workspaces' | 'agents', name: string): Promise<string | null> {
  const root = await managedPath(area, name);
  if (root !== null) return root;
  const dataDir = getDataDir();
  if (dataDir === null || !name || /[\\/]/.test(name) || name === '.' || name === '..') throw new Error('Invalid workspace path');
  const exists = await lstat(join(dataDir, area, name)).then(() => true, (error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  });
  if (exists) throw new Error('Cannot close this tab: its workspace path is not a managed directory');
  return null;
}
async function assertDisposable(root: string, heads: string[]): Promise<void> {
  const status = await gitAsync(['status', '--porcelain', '--untracked-files=all', '--ignored'], root);
  // The importer's ignored .glassbox directory contains disposable review exports.
  if (status.split('\n').some(line => line !== '' && !line.startsWith('!! .glassbox/')))
    throw new Error(`Cannot close this tab: unpublished files remain in ${root}`);
  const hasHead = await gitAsync(['rev-parse', '--verify', 'HEAD'], root).then(() => true, () => false);
  if (hasHead && !await safeHead(root, heads)) throw new Error(`Cannot close this tab: unpublished commits remain in ${root}`);
  if (await lstat(join(root, '.git', 'modules')).then(() => true, () => false)) throw new Error('Cannot remove a workspace with initialized submodules');
}

/** Delete app-owned data only. User clones and GitHub comments are never deleted. */
export async function discardTabData(tab: PullTab): Promise<void> {
  if (tab.comments.some(message => message.kind === 'ai' && message.status === 'working'))
    throw new Error('Wait for the comment agent to finish before closing this tab');
  const root = await ownedPath('workspaces', `${tab.ref.owner}-${tab.ref.repo}-${tab.ref.number}`);
  const agents: Array<{ root: string; common: string }> = [];
  for (const message of tab.comments) if (message.kind === 'ai') {
    const path = await ownedPath('agents', message.id);
    if (path === null) continue;
    await assertDisposable(path, [message.workspaceSafeHead ?? '', tab.reviewedHead, tab.info?.headRefOid ?? '']);
    const common = (await gitAsync(['rev-parse', '--path-format=absolute', '--git-common-dir'], path)).trim();
    const entries = (await gitAsync(['worktree', 'list', '--porcelain'], path)).split('\n\n');
    const entry = entries.find(value => value.split('\n').includes(`worktree ${path}`));
    if (entry === undefined || !entry.split('\n').includes('detached') || /\nlocked(?: |\n|$)/.test(entry))
      throw new Error('Cannot close this tab: an agent workspace is locked or has a local branch');
    agents.push({ root: path, common });
  }
  if (root !== null) {
    if (workspaceData().tabs.some(other => other !== tab && other.repoRoot === root))
      throw new Error('Cannot close this tab: its checkout is attached to another open review');
    if (!(await lstat(join(root, '.git'))).isDirectory()) throw new Error('Cannot remove an unmanaged Git worktree');
    await assertDisposable(root, [tab.reviewedHead, tab.info?.headRefOid ?? '']);
    const refs = (await gitAsync(['for-each-ref', '--format=%(refname)'], root)).trim().split('\n');
    if (refs.some(ref => ref !== '' && !ref.startsWith('refs/glassbox/cache/') && !ref.startsWith('refs/remotes/')))
      throw new Error('Cannot close this tab: its workspace has local Git branches');
    const worktrees = (await gitAsync(['worktree', 'list', '--porcelain'], root)).split('\n')
      .filter(line => line.startsWith('worktree ')).map(line => line.slice(9));
    if (worktrees.some(path => path !== root && !agents.some(agent => agent.root === path)))
      throw new Error('Cannot close this tab: another working tree still uses its Git repository');
    await preserveBorrowedObjects(root);
  }
  for (const agent of agents) await gitAsync(['--git-dir', agent.common, 'worktree', 'remove', agent.root], dirname(agent.common));
  if (root !== null) {
    tab.checkoutEvicted = true;
    saveWorkspace();
    await rm(root, { recursive: true });
  }
  // Cache collection is retryable housekeeping, never a reason to restore a deleted tab.
  await cleanupObjectCaches().catch((error: unknown) => { console.warn(`Git cache cleanup deferred: ${String(error)}`); });
  if (tab.reviewId !== null) {
    const db = await getDb();
    const running = await db.query('SELECT id FROM ai_analyses WHERE review_id = $1 AND status = $2', [tab.reviewId, 'running']);
    for (const row of z.array(z.object({ id: z.string() })).parse(running.rows)) markAnalysisCanceled(row.id);
    const review = await getReview(tab.reviewId);
    if (review) {
      deleteReviewExport(review.id, review.repo_path);
      const latest = join(review.repo_path, '.glassbox', 'latest-review.json');
      const parsed = await readFile(latest, 'utf8').then(text => JSON.parse(text) as { review?: { id?: string } }, () => null);
      if (parsed?.review?.id === review.id) {
        await rm(latest, { force: true });
        await rm(join(review.repo_path, '.glassbox', 'latest-review.md'), { force: true });
      }
    }
    await deleteReview(tab.reviewId);
  }
}
