import { z } from 'zod';

import { isPullAuthor, type PullTab } from '../api/workspace.js';
import { githubAccount } from './accounts.js';
import { github, loadPull, repoApi } from './github.js';

const merging = new WeakSet<PullTab>();
const MergeSettings = z.object({ allow_merge_commit: z.boolean(), allow_squash_merge: z.boolean(), allow_rebase_merge: z.boolean() });

/** Merge only the explicitly selected commit, after rechecking ownership and GitHub readiness. */
export async function mergePull(tab: PullTab, expectedHead: string, isActive = () => true): Promise<void> {
  if (!isPullAuthor(tab)) throw new Error('Merge is only available on your own PRs');
  if (tab.info?.state !== 'OPEN' || tab.info.isDraft) throw new Error('Only an open PR that is ready for review can be merged');
  if (!/^[a-f0-9]{40}$/i.test(expectedHead)) throw new Error('Refresh the PR before merging');
  if (merging.has(tab)) throw new Error('A merge is already in progress for this PR');
  merging.add(tab);
  try {
    const account = githubAccount(tab.ref);
    const [info, viewer, settings] = await Promise.all([
      loadPull(tab.ref),
      github(tab.ref, 'user').then(value => z.object({ login: z.string() }).parse(value)),
      github(tab.ref, repoApi(tab.ref)).then(value => MergeSettings.parse(value)),
    ]);
    if (!isActive()) throw new Error('The PR tab was closed before merging');
    if (account !== githubAccount(tab.ref)) throw new Error('GitHub account changed; refresh the PR before merging');
    if (info.author.login.toLowerCase() !== viewer.login.toLowerCase()) throw new Error('Merge is only available on your own PRs');
    // A retry after a lost response may find that GitHub already completed the merge.
    if (info.state === 'MERGED') {
      tab.info = info;
      tab.error = undefined;
      tab.action = 'merge';
      return;
    }
    if (info.state !== 'OPEN' || info.isDraft) throw new Error('Only an open PR that is ready for review can be merged');
    if (info.headRefOid !== expectedHead || (tab.reviewedHead && tab.reviewedHead !== expectedHead))
      throw new Error('New commits are available. Refresh the PR before merging');
    if (info.mergeable !== 'MERGEABLE' || !['CLEAN', 'HAS_HOOKS', 'UNSTABLE'].includes(info.mergeStateStatus))
      throw new Error('GitHub has not marked this PR ready to merge. Check its reviews, checks and conflicts, then refresh');
    const method = settings.allow_merge_commit ? 'merge' : settings.allow_squash_merge ? 'squash' : settings.allow_rebase_merge ? 'rebase' : null;
    if (method === null) throw new Error('This repository has no enabled merge method');
    // The SHA condition also protects against pushes made after the readiness check.
    const receipt = z.object({ merged: z.boolean(), message: z.string() }).parse(await github(
      tab.ref, `${repoApi(tab.ref)}/pulls/${tab.ref.number}/merge`, 'PUT', { sha: expectedHead, merge_method: method },
    ));
    if (!receipt.merged) throw new Error(receipt.message || 'GitHub did not merge the PR');
    tab.info = { ...info, state: 'MERGED', mergedAt: new Date().toISOString() };
    tab.error = undefined;
    tab.action = 'merge';
  } finally {
    merging.delete(tab);
  }
}
