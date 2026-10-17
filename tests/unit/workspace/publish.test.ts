import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PullTabSchema } from '../../../src/api/workspace.js';

const remote = vi.hoisted(() => ({ github: vi.fn() }));
vi.mock('../../../src/workspace/github.js', () => ({ github: remote.github,
  repoApi: () => 'repos/example/project', githubToken: async () => 'fixture' }));
import { publishAgentChanges } from '../../../src/workspace/publish.js';
let root: string, bare: string, sha: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'glassbox-publish-'));
  bare = join(root, 'remote.git');
  git('init', '-q'); git('init', '--bare', '-q', bare);
  git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(root, 'file.ts'), 'old\n'); git('add', 'file.ts'); git('commit', '-qm', 'base');
  sha = git('rev-parse', 'HEAD'); git('push', bare, 'HEAD:refs/heads/topic');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(root, 'signing-key')]);
  writeFileSync(join(root, 'allowed-signers'), 'test@example.com ' + readFileSync(join(root, 'signing-key.pub'), 'utf8'));
  git('config', 'gpg.format', 'ssh'); git('config', 'gpg.ssh.program', '/usr/bin/ssh-keygen');
  git('config', 'user.signingkey', join(root, 'signing-key')); git('config', 'gpg.ssh.allowedSignersFile', join(root, 'allowed-signers'));
  git('config', `url.${bare}.insteadOf`, 'https://github.com/example/project.git');
  writeFileSync(join(root, 'file.ts'), 'new\n');
  remote.github.mockReset(); remote.github.mockResolvedValue({ state: 'open', head: { sha, ref: 'topic', repo: { full_name: 'example/project' } } });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const tab = () => PullTabSchema.parse({ key: 'example/project#1', ref: { owner: 'example', repo: 'project', number: 1, url: 'https://github.com/example/project/pull/1' }, info: null, reviewId: 'r', repoRoot: root });
it('publishes a cryptographically verified signed commit to the PR head branch', async () => {
  const url = await publishAgentChanges(tab(), root, sha);
  const head = git('rev-parse', 'HEAD');
  expect(url).toBe(`https://github.com/example/project/commit/${head}`);
  expect(git('log', '-1', '--format=%G?')).toBe('G');
  expect(git('--git-dir', bare, 'rev-parse', 'refs/heads/topic')).toBe(head);
  expect(git('--git-dir', bare, 'show', 'topic:file.ts')).toBe('new');
});
it('never pushes if signing fails, and preserves the edits', async () => {
  git('config', 'user.signingkey', join(root, 'missing-key'));
  await expect(publishAgentChanges(tab(), root, sha)).rejects.toThrow();
  expect(git('--git-dir', bare, 'rev-parse', 'refs/heads/topic')).toBe(sha);
  expect(readFileSync(join(root, 'file.ts'), 'utf8')).toBe('new\n');
});
it('rejects a changed PR head before committing', async () => {
  remote.github.mockResolvedValue({ state: 'open', head: { sha: 'a'.repeat(40), ref: 'topic', repo: { full_name: 'example/project' } } });
  await expect(publishAgentChanges(tab(), root, sha)).rejects.toThrow('PR changed');
  expect(git('rev-parse', 'HEAD')).toBe(sha);
  expect(git('--git-dir', bare, 'rev-parse', 'refs/heads/topic')).toBe(sha);
});

it('does not overwrite a branch that advances after the GitHub head check', async () => {
  writeFileSync(join(root, 'file.ts'), 'someone else\n');
  git('add', 'file.ts'); git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'concurrent change');
  const remoteHead = git('rev-parse', 'HEAD'); git('push', bare, 'HEAD:refs/heads/topic');
  git('reset', '--hard', sha); writeFileSync(join(root, 'file.ts'), 'agent edit\n');
  await expect(publishAgentChanges(tab(), root, sha)).rejects.toThrow();
  expect(git('--git-dir', bare, 'rev-parse', 'refs/heads/topic')).toBe(remoteHead);
  expect(git('log', '-1', '--format=%G?')).toBe('G');
  expect(readFileSync(join(root, 'file.ts'), 'utf8')).toBe('agent edit\n');
});
