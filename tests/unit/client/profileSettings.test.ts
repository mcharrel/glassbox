import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), invoke: vi.fn(), refresh: vi.fn(), handlers: new Map<string, Function>() }));
vi.mock('kerfjs', async original => ({ ...await original<any>(), delegate: (_root: any, event: string, selector: string, fn: Function) => { mocks.handlers.set(`${event}:${selector}`, fn); } }));
vi.mock('../../../src/api/github-accounts.js', () => ({ getGitHubAccounts: mocks.get, saveGitHubAccounts: mocks.save }));
vi.mock('../../../src/client/tauri.js', () => ({ getTauriInvoke: () => mocks.invoke }));
vi.mock('../../../src/client/workspace/state.js', () => ({ refreshWorkspace: mocks.refresh }));
vi.mock('../../../src/client/dom.js', () => ({ asInput: (el: any) => el, asSelect: (el: any) => el }));
import { bindProfileTab, loadProfileTab, profileTab, resetProfileTab } from '../../../src/client/settings/profileTab.js';
import { generalTab } from '../../../src/client/settings/generalTab.js';
const data = () => ({ settings: { defaultUser: 'personal', organizations: { example: 'work_user' } }, users: ['personal', 'work_user'] });
const html = () => String(profileTab.render({} as any));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => {
  resetProfileTab(); mocks.handlers.clear();
  mocks.get.mockReset().mockResolvedValue(data());
  mocks.save.mockReset().mockImplementation(async settings => ({ ...data(), settings }));
  mocks.invoke.mockReset().mockResolvedValue({ supported: true, enabled: true, registered: false, browser: 'Example Browser' });
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  bindProfileTab({} as any);
});
afterEach(resetProfileTab);
it('keeps General limited to theme and sharing', () => {
  const result = String(generalTab.render({ activeThemeId: 'dark', themesData: { themes: [{ id: 'dark', name: 'Dark', builtIn: true }] } } as any));
  expect(result).toContain('Theme'); expect(result).toContain('Share rev');
  for (const removed of ['App Name', 'difftool', 'Database backups', 'Preserved unreadable data']) expect(result).not.toContain(removed);
});
it('shows local account routing and a default-on link preference with honest pending activation', async () => {
  loadProfileTab(); await tick();
  expect(html()).toContain('value="personal" selected');
  expect(html()).toContain('value="work_user" selected');
  expect(html()).toContain('Open PR links in rev');
  expect(html()).toContain('checked'); expect(html()).toContain('Enable in macOS');
  expect(html()).toContain('Example Browser'); expect(html()).not.toContain('experience level');
});
it('saves a default account change and refreshes displayed ownership', async () => {
  loadProfileTab(); await tick();
  mocks.handlers.get('change:#github-default-user')!({}, { value: 'work_user' });
  await tick();
  expect(mocks.save).toHaveBeenCalledWith({ defaultUser: 'work_user', organizations: { example: 'work_user' } });
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
it('requests macOS approval only on setup and persists disabling through the native bridge', async () => {
  loadProfileTab(); await tick();
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('get_pr_link_routing');
  mocks.handlers.get('click:#pr-link-setup')!(); await tick();
  expect(mocks.invoke).toHaveBeenLastCalledWith('set_pr_link_routing', { enabled: true });
  mocks.handlers.get('change:#pr-link-routing')!({}, { checked: false }); await tick();
  expect(mocks.invoke).toHaveBeenLastCalledWith('set_pr_link_routing', { enabled: false });
});
it('does not apply a late account response to a newly opened settings dialog', async () => {
  let finish!: Function;
  mocks.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  loadProfileTab(); resetProfileTab(); loadProfileTab(); await tick();
  finish({ ...data(), settings: { defaultUser: 'stale', organizations: { stale: 'stale' } } }); await tick();
  expect(html()).not.toContain('stale'); expect(html()).toContain('value="personal" selected');
});
