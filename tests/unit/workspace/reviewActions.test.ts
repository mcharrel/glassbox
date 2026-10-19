import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('node:child_process', () => ({ execFile: Object.assign(vi.fn(), {
  [Symbol.for('nodejs.util.promisify.custom')]: async () => ({ stdout: 'fixture-token', stderr: '' }),
}) }));
vi.mock('node:fs', () => ({ readFileSync: () => '{}' }));
import { PullTabSchema, viewerReviewState } from '../../../src/api/workspace.js';
import { mutatePull } from '../../../src/workspace/github.js';
const tab = PullTabSchema.parse({ key: 'example/project#1', ref: { owner: 'example', repo: 'project', number: 1, url: '' }, reviewId: null, repoRoot: null,
  viewer: 'me', info: { id: 'PR1', number: 1, url: '', title: 'Example', body: '', author: { login: 'other' }, state: 'OPEN', isDraft: false,
    baseRefName: 'main', headRefName: 'topic', baseRefOid: 'base', headRefOid: 'head', mergeable: 'MERGEABLE', mergedAt: null } });
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => { tab.info!.reviews = []; });
const receipt = (state = 'CHANGES_REQUESTED', submitted_at = '2026-01-01T12:00:00Z') => ({ user: { login: 'me' }, state, submitted_at });
it('publishes the human-explanation choice as a GitHub request-changes review with the exact comment', async () => {
  const fetch = vi.fn(async () => Response.json(receipt())); vi.stubGlobal('fetch', fetch);
  await mutatePull(tab, 'humanize');
  expect(fetch.mock.calls[0][0]).toBe('https://api.github.com/repos/example/project/pulls/1/reviews');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ event: 'REQUEST_CHANGES',
    body: 'Could you make the explanations (description, in-line comments) easier to digest for a human ?' });
  expect(viewerReviewState(tab)).toBe('CHANGES_REQUESTED');
});
it('requires text for a normal code-change request and preserves an approval as a separate action', async () => {
  const fetch = vi.fn(async () => Response.json(receipt('APPROVED'))); vi.stubGlobal('fetch', fetch);
  await expect(mutatePull(tab, 'changes', ' ')).rejects.toThrow('Explain the requested changes');
  expect(fetch).not.toHaveBeenCalled();
  await mutatePull(tab, 'approve');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ event: 'APPROVE' });
  expect(viewerReviewState(tab)).toBe('APPROVED');
});
it('retains the accepted review when the next submission fails, then replaces it on success', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json(receipt('APPROVED')))
    .mockResolvedValueOnce(Response.json({ message: 'Unavailable' }, { status: 503 }))
    .mockResolvedValueOnce(Response.json(receipt('CHANGES_REQUESTED', '2026-01-01T13:00:00Z'))));
  await mutatePull(tab, 'approve');
  await expect(mutatePull(tab, 'changes', 'Please simplify')).rejects.toThrow('Unavailable');
  expect(viewerReviewState(tab)).toBe('APPROVED');
  await mutatePull(tab, 'changes', 'Please simplify');
  expect(viewerReviewState(tab)).toBe('CHANGES_REQUESTED');
});
