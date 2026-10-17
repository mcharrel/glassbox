import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { z } from 'zod';

import type { PullTab } from '../api/workspace.js';
import { gitAsync, gitAuthEnv } from './checkout.js';
import { github, repoApi } from './github.js';

const exec = promisify(execFile);
const HeadSchema = z.object({ state: z.literal('open'), head: z.object({
  sha: z.string().regex(/^[a-f0-9]{40}$/), ref: z.string().min(1),
  repo: z.object({ full_name: z.string().regex(/^[\w.-]+\/[\w.-]+$/) }),
}) });
export async function currentPullHead(tab: PullTab) {
  const { head } = HeadSchema.parse(await github(tab.ref, `${repoApi(tab.ref)}/pulls/${tab.ref.number}`));
  return { sha: head.sha, branch: head.ref, url: `https://github.com/${head.repo.full_name}.git`, repo: head.repo.full_name };
}
export async function prepareAgentHead(tab: PullTab): Promise<string> {
  if (tab.repoRoot === null) throw new Error('PR checkout is unavailable');
  const head = await currentPullHead(tab);
  try { await gitAsync(['cat-file', '-e', `${head.sha}^{commit}`], tab.repoRoot); }
  catch { await gitAsync(['fetch', '--no-tags', head.url, head.sha], tab.repoRoot, await gitAuthEnv(tab)); }
  return head.sha;
}

/** Sign and verify locally before publishing; a moving remote branch is never overwritten. */
export async function publishAgentChanges(tab: PullTab, root: string, baseHead: string): Promise<string> {
  const changed = (await gitAsync(['diff', '--name-only', '-z'], root)).split('\0').filter(Boolean);
  const goFiles = changed.filter(path => path.endsWith('.go'));
  if (goFiles.length) await exec('gofmt', ['-w', ...goFiles], { cwd: root, timeout: 30000 });
  await gitAsync(['diff', '--check'], root);
  const target = await currentPullHead(tab);
  if (target.sha !== baseHead) throw new Error('The PR changed while the agent worked. Local edits were kept; retry against its latest commit.');
  await gitAsync(['check-ref-format', `refs/heads/${target.branch}`], root);
  await gitAsync(['add', '--update'], root);
  await gitAsync(['-c', 'commit.gpgsign=true', 'commit', '-S', '-m', `Address review feedback on PR #${tab.ref.number}`], root);
  await gitAsync(['verify-commit', 'HEAD'], root);
  const commit = (await gitAsync(['rev-parse', 'HEAD'], root)).trim();
  await gitAsync(['push', target.url, `HEAD:refs/heads/${target.branch}`], root, await gitAuthEnv(tab));
  return `https://github.com/${target.repo}/commit/${commit}`;
}
