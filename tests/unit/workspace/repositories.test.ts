import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const config = vi.hoisted(() => ({ home: '', repositories: {} as Record<string, string> }));
vi.mock('node:os', async original => ({ ...(await original<typeof import('node:os')>()), homedir: () => config.home }));
vi.mock('../../../src/workspace/github.js', () => ({ localWorkspaceConfig: () => ({ repositories: config.repositories }) }));
import { findLocalRepository } from '../../../src/workspace/repositories.js';
const ref = { owner: 'example-org', repo: 'example-app', number: 1, url: '' };
beforeEach(() => { config.home = mkdtempSync(join(tmpdir(), 'glassbox-repositories-')); config.repositories = {}; vi.stubEnv('GOPATH', ''); });
afterEach(() => { rmSync(config.home, { recursive: true, force: true }); vi.unstubAllEnvs(); });
function clone(path: string, remote: string) {
  mkdirSync(path, { recursive: true });
  execFileSync('git', ['init', '-q', path]);
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: path });
  return path;
}
it('finds a clone under an old organization folder using its actual SSH-alias remote', async () => {
  const path = clone(join(config.home, 'go/src/github.com/old-org/example-app'), 'git@example-org.github.com:example-org/example-app.git');
  expect(await findLocalRepository(ref)).toBe(path);
});
it('ignores same-named repositories from a different owner or host', async () => {
  clone(join(config.home, 'code/example-app'), 'https://github.com/someone/example-app.git');
  clone(join(config.home, 'src/example-app'), 'git@example.com:example-org/example-app.git');
  expect(await findLocalRepository(ref)).toBeUndefined();
});
it('prefers a configured matching clone over discovered ones and handles an empty directory list', async () => {
  expect(await findLocalRepository(ref)).toBeUndefined();
  const path = clone(join(config.home, 'custom'), 'https://github.com/example-org/example-app.git');
  config.repositories['example-org/example-app'] = path;
  clone(join(config.home, 'code/example-app'), 'git@github.com:example-org/example-app.git');
  expect(await findLocalRepository(ref)).toBe(path);
});
