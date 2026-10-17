import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { PullTabSchema } from '../../../src/api/workspace.js';

const mocks = vi.hoisted(() => ({ dataDir: '', file: vi.fn() }));
vi.mock('../../../src/db/connection.js', () => ({ getDataDir: () => mocks.dataDir }));
vi.mock('../../../src/db/queries.js', () => ({ createReview: async () => ({ id: 'review' }), addReviewFile: mocks.file, updateReviewSource: vi.fn() }));
vi.mock('../../../src/review-update.js', () => ({ updateReviewDiffs: vi.fn() }));
vi.mock('../../../src/workspace/storage.js', () => ({ workspaceData: () => ({ tabs: [] }) }));
vi.mock('../../../src/workspace/github.js', () => ({ githubToken: async () => 'fixture' }));
import { importPull } from '../../../src/workspace/checkout.js';

it('fetches missing objects through a shared checkout, protects them from GC, and leaves its source untouched', async () => {
  const root = mkdtempSync(join(tmpdir(), 'glassbox-import-test-'));
  try {
    const remote = join(root, 'remote'); const source = join(root, 'source');
    mkdirSync(remote); mkdirSync(source); mocks.dataDir = join(root, 'data');
    const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(remote, 'init', '-q'); git(remote, 'config', 'user.name', 'Test'); git(remote, 'config', 'user.email', 'test@example.com');
    git(remote, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(remote, 'file.ts'), 'before\n'); git(remote, 'add', '.'); git(remote, 'commit', '-qm', 'base');
    const base = git(remote, 'rev-parse', 'HEAD');
    git(source, 'init', '-q'); git(source, 'fetch', remote, base); git(source, 'checkout', '--detach', base);
    writeFileSync(join(source, 'file.ts'), 'user work\n');
    writeFileSync(join(remote, 'file.ts'), 'after\n'); git(remote, 'add', '.'); git(remote, 'commit', '-qm', 'change');
    const head = git(remote, 'rev-parse', 'HEAD');
    git(source, 'config', `url.${remote}.insteadOf`, 'https://github.com/example/project.git');
    const tab = PullTabSchema.parse({ key: 'example/project#1', ref: { owner: 'example', repo: 'project', number: 1, url: '' }, reviewId: null, repoRoot: source,
      info: { id: 'PR1', number: 1, url: '', title: 'Example', body: '', author: { login: 'test' }, state: 'OPEN', isDraft: false,
        baseRefName: 'main', headRefName: 'topic', baseRefOid: base, headRefOid: head, mergeable: 'MERGEABLE', mergedAt: null } });
    await importPull(tab);
    expect(tab.reviewId).toBe('review');
    expect(readFileSync(join(source, 'file.ts'), 'utf8')).toBe('user work\n');
    expect(git(source, 'rev-parse', 'HEAD')).toBe(base);
    expect(git(source, 'rev-parse', `refs/glassbox/cache/${head}`)).toBe(head);
    expect(readFileSync(join(tab.repoRoot!, 'file.ts'), 'utf8')).toBe('after\n');
    expect(mocks.file).toHaveBeenCalledWith('review', 'file.ts', expect.stringContaining('after'));
    git(source, 'gc', '--prune=now');
    expect(git(tab.repoRoot!, 'show', 'HEAD:file.ts')).toBe('after');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
