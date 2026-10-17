import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PullTabSchema, ThreadMessageSchema } from '../../../src/api/workspace.js';
import type { WorkspaceDisk } from '../../../src/workspace/storage.js';

const mocks = vi.hoisted(() => ({ root: '', source: '', save: vi.fn(), update: vi.fn(),
  data: { tabs: [], archived: [], active: null, outbox: [] } as WorkspaceDisk }));
vi.mock('../../../src/db/connection.js', () => ({ getDataDir: () => mocks.root }));
vi.mock('../../../src/db/queries.js', () => ({ createReview: vi.fn(), addReviewFile: vi.fn(), updateReviewSource: mocks.update }));
vi.mock('../../../src/review-update.js', () => ({ updateReviewDiffs: mocks.update }));
vi.mock('../../../src/workspace/storage.js', () => ({ workspaceData: () => mocks.data, saveWorkspace: mocks.save }));
vi.mock('../../../src/workspace/github.js', () => ({ githubToken: async () => 'fixture', github: vi.fn(() => { throw Error('No GitHub reads during local cleanup/restoration'); }), repoApi: () => '' }));
vi.mock('../../../src/workspace/repositories.js', () => ({ findLocalRepository: async () => mocks.source || undefined }));
import * as checkout from '../../../src/workspace/checkout.js';
import { cleanupWorkspaces, WORKSPACE_RETENTION_MS } from '../../../src/workspace/retention.js';

const now = Date.now() + 1000;
const old = now - WORKSPACE_RETENTION_MS - 1000;
const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function age(root: string) { utimesSync(root, old / 1000, old / 1000); }
function commit(root: string) { git(root, 'add', 'file.ts'); git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'); }
function fixture(number = 1) {
  const root = join(mocks.root, 'workspaces', `example-project-${number}`); mkdirSync(root, { recursive: true });
  git(root, 'init', '-q'); writeFileSync(join(root, 'file.ts'), 'before\n'); commit(root);
  const head = git(root, 'rev-parse', 'HEAD');
  const branch = git(root, 'branch', '--show-current'); git(root, 'checkout', '--detach', head); git(root, 'branch', '-D', branch);
  const tab = PullTabSchema.parse({ key: `example/project#${number}`, ref: { owner: 'example', repo: 'project', number, url: '' }, repoRoot: root,
    reviewId: `review${number}`, reviewedHead: head, reviewedBase: head, updatedAt: old, lastUsedAt: old, viewer: 'me', commentsLoaded: true,
    info: { id: 'pr', number, url: '', title: 'Example', body: '', author: { login: 'me' }, state: 'OPEN', isDraft: false,
      baseRefName: 'main', headRefName: 'topic', baseRefOid: head, headRefOid: head, mergeable: 'MERGEABLE', mergedAt: null } });
  mocks.data.tabs.push(tab); age(root); return tab;
}
function agent(tab: ReturnType<typeof fixture>, id = 'agent') {
  const root = join(mocks.root, 'agents', id); git(tab.repoRoot!, 'worktree', 'add', '--detach', root, tab.reviewedHead);
  const message = ThreadMessageSchema.parse({ id, kind: 'ai', body: 'Done', author: 'AI', status: 'done', date: new Date(old).toISOString(),
    workspaceUpdatedAt: old, workspaceSafeHead: tab.reviewedHead });
  tab.comments.push(message); age(root); age(tab.repoRoot!); return { root, message };
}
beforeEach(() => {
  mocks.root = realpathSync(mkdtempSync(join(tmpdir(), 'glassbox-retention-'))); mocks.source = '';
  mocks.data = { tabs: [], archived: [], active: null, outbox: [] }; mocks.save.mockClear(); mocks.update.mockClear();
});
afterEach(() => { vi.restoreAllMocks(); rmSync(mocks.root, { recursive: true, force: true }); });

it('handles no workspaces and removes a clean stale checkout without removing its review or comments', async () => {
  expect(await cleanupWorkspaces(now)).toEqual({ reviews: 0, agents: 0 });
  const tab = fixture(); tab.comments.push(ThreadMessageSchema.parse({ id: 'comment', kind: 'review', body: 'Keep me', author: 'me', date: '' }));
  expect(await cleanupWorkspaces(now)).toEqual({ reviews: 1, agents: 0 });
  expect(existsSync(tab.repoRoot!)).toBe(false); expect(tab.checkoutEvicted).toBe(true); expect(tab.reviewId).toBe('review1');
  expect(tab.comments[0].body).toBe('Keep me'); expect(mocks.data.tabs).toContain(tab); expect(mocks.save).toHaveBeenCalled();
  expect(await cleanupWorkspaces(now)).toEqual({ reviews: 0, agents: 0 });
});
it.each(['active', 'recent', 'loading', 'outbox', 'dirty', 'untracked', 'ignored', 'commit', 'branch', 'pinned'])(
  'preserves %s work', async kind => {
    const tab = fixture(), root = tab.repoRoot!;
    if (kind === 'active') mocks.data.active = tab.key;
    if (kind === 'recent') tab.lastUsedAt = now - WORKSPACE_RETENTION_MS + 1;
    if (kind === 'loading') tab.loading = true;
    if (kind === 'outbox') mocks.data.outbox.push({ id: 'o', tab: tab.key, message: 'c', operation: 'create', nextAttempt: 0, attempted: false });
    if (kind === 'dirty') writeFileSync(join(root, 'file.ts'), 'local edits\n');
    if (kind === 'untracked') writeFileSync(join(root, 'notes.txt'), 'local notes');
    if (kind === 'ignored') { writeFileSync(join(root, '.git/info/exclude'), 'notes.txt\n'); writeFileSync(join(root, 'notes.txt'), 'private notes'); }
    if (kind === 'commit') { writeFileSync(join(root, 'file.ts'), 'unpushed\n'); commit(root); }
    if (kind === 'branch') git(root, 'branch', 'user-branch');
    age(root);
    expect(await cleanupWorkspaces(now, kind === 'pinned' ? root : undefined)).toEqual({ reviews: 0, agents: 0 });
    expect(existsSync(root)).toBe(true); expect(tab.checkoutEvicted).toBe(false);
  });
it('honors the exact fourteen-day boundary and both open and archived PRs', async () => {
  const tab = fixture(); mocks.data.tabs = []; mocks.data.archived = [tab];
  tab.lastUsedAt = now - WORKSPACE_RETENTION_MS;
  expect((await cleanupWorkspaces(now - 1)).reviews).toBe(0);
  expect((await cleanupWorkspaces(now)).reviews).toBe(1);
});
it('keeps a shared provider until its last borrower expires, then removes dependents first', async () => {
  const provider = fixture(1), borrower = fixture(2);
  writeFileSync(join(borrower.repoRoot!, '.git/objects/info/alternates'), join(provider.repoRoot!, '.git/objects') + '\n');
  borrower.lastUsedAt = now;
  expect((await cleanupWorkspaces(now)).reviews).toBe(0);
  expect(git(borrower.repoRoot!, 'show', 'HEAD:file.ts')).toBe('before');
  borrower.lastUsedAt = old;
  expect((await cleanupWorkspaces(now)).reviews).toBe(2);
});
it.each(['clean', 'published', 'dirty', 'unpublished', 'working', 'recent', 'locked'])(
  'handles %s agent worktrees with Git and preserves unsafe ones', async kind => {
    const tab = fixture(); const { root, message } = agent(tab);
    if (kind === 'dirty') writeFileSync(join(root, 'file.ts'), 'local edit');
    if (kind === 'published' || kind === 'unpublished') {
      writeFileSync(join(root, 'file.ts'), 'agent commit'); commit(root);
      if (kind === 'published') message.workspaceSafeHead = git(root, 'rev-parse', 'HEAD');
    }
    if (kind === 'working') message.status = 'working';
    if (kind === 'recent') message.workspaceUpdatedAt = now;
    if (kind === 'locked') git(tab.repoRoot!, 'worktree', 'lock', root);
    age(root); age(tab.repoRoot!);
    const disposable = kind === 'clean' || kind === 'published';
    expect(await cleanupWorkspaces(now)).toEqual({ reviews: disposable ? 1 : 0, agents: disposable ? 1 : 0 });
    expect(existsSync(root)).toBe(!disposable);
  });
it('never follows a managed-directory symlink or deletes an attached user clone', async () => {
  const tab = fixture(); const original = tab.repoRoot!;
  const outside = join(mocks.root, 'user-repo'); git(mocks.root, 'clone', '--quiet', original, outside);
  rmSync(original, { recursive: true }); symlinkSync(outside, original); tab.repoRoot = outside;
  expect((await cleanupWorkspaces(now)).reviews).toBe(0); expect(existsSync(join(outside, 'file.ts'))).toBe(true);
});
it('rechecks selection after slow Git inspection rather than deleting a newly selected PR', async () => {
  const tab = fixture(); const run = checkout.gitAsync;
  vi.spyOn(checkout, 'gitAsync').mockImplementation(async (args, root, env) => {
    const result = await run(args, root, env);
    if (args[0] === 'for-each-ref') mocks.data.active = tab.key;
    return result;
  });
  expect((await cleanupWorkspaces(now)).reviews).toBe(0); expect(existsSync(tab.repoRoot!)).toBe(true);
});
it('restores the saved revision locally without rewriting annotations or using newer cached GitHub metadata', async () => {
  const tab = fixture(); const root = tab.repoRoot!;
  const source = join(mocks.root, 'source'); git(mocks.root, 'clone', '--quiet', root, source); mocks.source = source;
  expect((await cleanupWorkspaces(now)).reviews).toBe(1);
  tab.info!.headRefOid = 'a'.repeat(40); tab.info!.baseRefOid = 'b'.repeat(40);
  await Promise.all([checkout.ensureCheckout(tab), checkout.ensureCheckout(tab)]);
  expect(tab.checkoutEvicted).toBe(false); expect(git(root, 'rev-parse', 'HEAD')).toBe(tab.reviewedHead);
  expect(tab.info!.headRefOid).toBe('a'.repeat(40)); expect(mocks.update).not.toHaveBeenCalled(); expect(tab.reviewId).toBe('review1');
});
it('cleans an interrupted empty import but preserves an unpublished empty commit', async () => {
  const tab = fixture(); rmSync(tab.repoRoot!, { recursive: true }); mkdirSync(tab.repoRoot!); git(tab.repoRoot!, 'init', '-q'); age(tab.repoRoot!);
  expect((await cleanupWorkspaces(now)).reviews).toBe(1);
  const other = fixture(2); git(other.repoRoot!, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'unpublished');
  expect((await cleanupWorkspaces(now)).reviews).toBe(0);
});
