import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const config = vi.hoisted(() => ({ home: '', repositories: {} as Record<string, string> }));
vi.mock('node:os', async original => ({ ...(await original<typeof import('node:os')>()), homedir: () => config.home }));
vi.mock('../../../src/workspace/github.js', () => ({ localWorkspaceConfig: () => ({ repositories: config.repositories }) }));
import { findLocalRepository } from '../../../src/workspace/repositories.js';
const ref = { owner: 'ddoghq', repo: 'dd-go', number: 1, url: '' };
beforeEach(() => { config.home = mkdtempSync(join(tmpdir(), 'glassbox-repositories-')); config.repositories = {}; vi.stubEnv('GOPATH', ''); });
afterEach(() => { rmSync(config.home, { recursive: true, force: true }); vi.unstubAllEnvs(); });
function clone(path: string, remote: string) {
  mkdirSync(path, { recursive: true });
  execFileSync('git', ['init', '-q', path]);
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: path });
  return path;
}
it('finds a clone under an old organization folder using its actual SSH-alias remote', async () => {
  const path = clone(join(config.home, 'go/src/github.com/DataDog/dd-go'), 'git@ddoghq.github.com:ddoghq/dd-go.git');
  expect(await findLocalRepository(ref)).toBe(path);
});
it('ignores same-named repositories from a different owner or host', async () => {
  clone(join(config.home, 'code/dd-go'), 'https://github.com/someone/dd-go.git');
  clone(join(config.home, 'src/dd-go'), 'git@example.com:ddoghq/dd-go.git');
  expect(await findLocalRepository(ref)).toBeUndefined();
});
it('prefers a configured matching clone over discovered ones and handles an empty directory list', async () => {
  expect(await findLocalRepository(ref)).toBeUndefined();
  const path = clone(join(config.home, 'custom'), 'https://github.com/ddoghq/dd-go.git');
  config.repositories['ddoghq/dd-go'] = path;
  clone(join(config.home, 'code/dd-go'), 'git@github.com:ddoghq/dd-go.git');
  expect(await findLocalRepository(ref)).toBe(path);
});
