import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ config: {} as Record<string, any>, legacy: {} as Record<string, string>, exec: vi.fn(), now: 0 }));
vi.mock('../../../src/global-config.js', () => ({ readGlobalConfig: () => mocks.config, updateGlobalConfig: (fn: any) => fn(mocks.config) }));
vi.mock('node:fs', () => ({ readFileSync: () => JSON.stringify({ accounts: mocks.legacy }) }));
vi.mock('node:child_process', () => ({ execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: mocks.exec }) }));
import { accountSettings, getAccountSettings, githubAccount, saveAccountSettings } from '../../../src/workspace/accounts.js';
import { github, githubToken, parsePullUrl } from '../../../src/workspace/github.js';
const ref = (org = 'example') => parsePullUrl(`https://github.com/${org}/repo/pull/1`);
beforeEach(() => {
  mocks.config = {}; mocks.legacy = {}; mocks.now += 600001;
  vi.spyOn(Date, 'now').mockReturnValue(mocks.now);
  mocks.exec.mockReset().mockImplementation(async (_cmd, args) => ({ stdout: args[1] === 'status'
    ? JSON.stringify({ hosts: { 'github.com': [{ login: 'personal', active: true }, { login: 'work_user', active: false }] } })
    : `fixture-${args.at(-1)}`, stderr: '' }));
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true })));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('uses the selected default and case-insensitive organization exceptions', async () => {
  await saveAccountSettings({ defaultUser: 'PERSONAL', organizations: { Example: 'WORK_user' } });
  expect(githubAccount(ref('EXAMPLE'))).toBe('work_user');
  expect(githubAccount(ref('other'))).toBe('personal');
  expect(accountSettings()).toEqual({ defaultUser: 'personal', organizations: { example: 'work_user' } });
});
it('starts from legacy routing, but an explicit empty mapping really removes the exception', async () => {
  mocks.legacy = { Example: 'work_user', 'Example/repo': 'personal' };
  expect(githubAccount(ref())).toBe('personal');
  expect(accountSettings().organizations).toEqual({ Example: 'work_user' });
  await saveAccountSettings({ defaultUser: 'personal', organizations: {} });
  expect(githubAccount(ref())).toBe('personal');
  expect(accountSettings().organizations).toEqual({});
});
it('shows the active signed-in account as the initial default and preserves unrelated settings', async () => {
  mocks.config.themes = { active: 'dark' };
  expect(await getAccountSettings()).toEqual({ settings: { defaultUser: 'personal', organizations: {} }, users: ['personal', 'work_user'] });
  await saveAccountSettings({ defaultUser: 'personal', organizations: {} });
  expect(mocks.config.themes).toEqual({ active: 'dark' });
  expect(mocks.exec.mock.calls.every(([, args]) => !args.includes('switch'))).toBe(true);
});
it.each([
  { defaultUser: '', organizations: {} },
  { defaultUser: 'missing', organizations: {} },
  { defaultUser: 'personal', organizations: { example: 'missing' } },
  { defaultUser: 'personal', organizations: { Example: 'personal', example: 'work_user' } },
  { defaultUser: 'personal', organizations: { 'bad/org': 'work_user' } },
])('rejects invalid or unauthenticated mappings without saving: %j', async settings => {
  await expect(saveAccountSettings(settings)).rejects.toThrow();
  expect(mocks.config).toEqual({});
});
it('keeps simultaneous API reads and Git fetch credentials on their own accounts without gh auth switch', async () => {
  mocks.config.githubAccounts = { defaultUser: 'personal', organizations: { example: 'work_user' } };
  await Promise.all([github(ref(), 'user'), github(ref('other'), 'user')]);
  expect(vi.mocked(fetch).mock.calls.map(([, opts]) => opts?.headers?.Authorization).sort()).toEqual(['Bearer fixture-personal', 'Bearer fixture-work_user']);
  expect(await githubToken(ref())).toBe('fixture-work_user');
  expect(mocks.exec).toHaveBeenCalledTimes(2);
  for (const [, args] of mocks.exec.mock.calls) expect(args.slice(0, 5)).toEqual(['auth', 'token', '--hostname', 'github.com', '--user']);
});
it('does not fall back to another account if its configured token is unavailable', async () => {
  mocks.config.githubAccounts = { defaultUser: 'unavailable', organizations: {} };
  mocks.exec.mockRejectedValue(new Error('Not signed in'));
  await expect(github(ref(), 'user')).rejects.toThrow('Not signed in');
  expect(fetch).not.toHaveBeenCalled();
});
it('cancels a write if account settings change while obtaining credentials', async () => {
  mocks.config.githubAccounts = { defaultUser: 'old-account', organizations: {} };
  mocks.exec.mockImplementation(async () => {
    mocks.config.githubAccounts.defaultUser = 'personal';
    return { stdout: 'unused-fixture-token' };
  });
  await expect(github(ref(), 'issues/comments', 'POST', { body: 'hello' })).rejects.toThrow('account changed');
  expect(fetch).not.toHaveBeenCalled();
});
it('rejects a stale response after an account switch', async () => {
  mocks.config.githubAccounts = { defaultUser: 'personal', organizations: {} };
  vi.mocked(fetch).mockImplementation(async () => {
    mocks.config.githubAccounts.defaultUser = 'work_user';
    return Response.json({ login: 'personal' });
  });
  await expect(github(ref(), 'user')).rejects.toThrow('account changed');
});

it('keeps a successful write receipt when settings change after dispatch', async () => {
  mocks.config.githubAccounts = { defaultUser: 'personal', organizations: {} };
  vi.mocked(fetch).mockImplementation(async () => {
    mocks.config.githubAccounts.defaultUser = 'work_user';
    return Response.json({ id: 123 });
  });
  await expect(github(ref(), 'issues/comments', 'POST', { body: 'hello' })).resolves.toEqual({ id: 123 });
});
it('never exposes authentication command output in settings errors', async () => {
  mocks.exec.mockRejectedValue(new Error('private command output'));
  await expect(getAccountSettings()).rejects.toThrow('Could not read signed-in GitHub accounts.');
});
