import { afterEach, expect, it, vi } from 'vitest';
vi.mock('node:child_process', () => ({ execFile: Object.assign(vi.fn(), {
  [Symbol.for('nodejs.util.promisify.custom')]: async () => ({ stdout: 'fixture-token', stderr: '' }),
}) }));
vi.mock('node:fs', () => ({ readFileSync: () => '{}' }));
import { PullTabSchema } from '../../../src/api/workspace.js';
import { mutatePull } from '../../../src/workspace/github.js';
const tab = PullTabSchema.parse({ key: 'example/project#1', ref: { owner: 'example', repo: 'project', number: 1, url: '' }, reviewId: null, repoRoot: null,
  info: { id: 'PR1', number: 1, url: '', title: 'Example', body: '', author: { login: 'other' }, state: 'OPEN', isDraft: false,
    baseRefName: 'main', headRefName: 'topic', baseRefOid: 'base', headRefOid: 'head', mergeable: 'MERGEABLE', mergedAt: null } });
afterEach(() => vi.unstubAllGlobals());
it('publishes the human-explanation choice as a GitHub request-changes review with the exact comment', async () => {
  const fetch = vi.fn(async () => Response.json({})); vi.stubGlobal('fetch', fetch);
  await mutatePull(tab, 'humanize');
  expect(fetch.mock.calls[0][0]).toBe('https://api.github.com/repos/example/project/pulls/1/reviews');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ event: 'REQUEST_CHANGES',
    body: 'Could you make the explanations (description, in-line comments) easier to digest for a human ?' });
});
it('requires text for a normal code-change request and preserves an approval as a separate action', async () => {
  const fetch = vi.fn(async () => Response.json({})); vi.stubGlobal('fetch', fetch);
  await expect(mutatePull(tab, 'changes', ' ')).rejects.toThrow('Explain the requested changes');
  expect(fetch).not.toHaveBeenCalled();
  await mutatePull(tab, 'approve');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ event: 'APPROVE' });
});
