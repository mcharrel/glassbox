import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), chats: vi.fn(), link: vi.fn(), refresh: vi.fn(), tab: null as any, handlers: new Map<string, Function>() }));
vi.mock('kerfjs', async original => ({ ...await original<any>(), delegate: (_root: any, event: string, selector: string, fn: Function) => mocks.handlers.set(`${event}:${selector}`, fn) }));
vi.mock('../../../src/api/codex-connection.js', () => ({ getCodexSetup: mocks.get, setCodexSetup: mocks.set, getCodexChats: mocks.chats, linkCodexChat: mocks.link }));
vi.mock('../../../src/client/dom.js', () => ({ asInput: (el: any) => el, asSelect: (el: any) => el }));
vi.mock('../../../src/client/workspace/state.js', () => ({ activeTab: () => mocks.tab, refreshWorkspace: mocks.refresh }));
import { bindCodexSettings, renderCodexConnection, resetCodexSettings, showCodexSettings } from '../../../src/client/settings/codexConnection.js';
const status = (state: string) => ({ enabled: state !== 'disabled', supported: true, state, message: state === 'restart' ? 'Quit and reopen Codex once' : state });
const html = () => String(renderCodexConnection());
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => {
  resetCodexSettings(); mocks.handlers.clear();
  mocks.get.mockReset().mockResolvedValue(status('disabled')); mocks.set.mockReset().mockResolvedValue(status('restart'));
  mocks.chats.mockReset().mockResolvedValue({ chats: [{ id: 'chat', title: 'Original implementation' }] });
  mocks.link.mockReset().mockResolvedValue({ ok: true }); mocks.refresh.mockReset().mockResolvedValue(undefined);
  mocks.tab = { key: 'example/repo#1', viewer: 'alice', info: { author: { login: 'alice' } } }; bindCodexSettings({} as any);
});
afterEach(resetCodexSettings);
it('loads only when Experimental is visible and enables with a checkbox', async () => {
  expect(mocks.get).not.toHaveBeenCalled(); showCodexSettings(true); await tick();
  expect(html()).toContain('Connect to Codex'); expect(html()).not.toContain('checked');
  mocks.get.mockResolvedValue(status('restart'));
  mocks.handlers.get('change:#codex-connect')!({}, { checked: true }); await tick();
  expect(mocks.set).toHaveBeenCalledWith(true); expect(html()).toContain('Quit and reopen Codex once'); expect(html()).toContain('checked');
});
it('lets an own PR select its existing chat without a pasted prompt or a new agent', async () => {
  mocks.get.mockResolvedValue(status('connected')); showCodexSettings(true); await tick();
  expect(html()).toContain('Original implementation');
  mocks.handlers.get('change:#codex-chat')!({}, { value: 'chat' }); await tick();
  expect(mocks.link).toHaveBeenCalledWith('example/repo#1', 'chat'); expect(mocks.refresh).toHaveBeenCalledOnce();
  mocks.tab.info.author.login = 'other'; expect(html()).not.toContain('id="codex-chat"');
});
it('clears busy after setup even if the user switches settings tabs while it runs', async () => {
  let finish!: Function; mocks.set.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  showCodexSettings(true); await tick(); mocks.handlers.get('change:#codex-connect')!({}, { checked: true });
  showCodexSettings(false); showCodexSettings(true); finish(status('restart')); await tick();
  expect(html()).not.toContain('Setting up…');
});
it('ignores an old response after the dialog is closed and reopened', async () => {
  let finish!: Function; mocks.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  showCodexSettings(true); resetCodexSettings(); showCodexSettings(true); await tick();
  finish(status('connected')); await tick(); expect(html()).not.toContain('Chat for this PR');
});
it('keeps failed setup visible and can turn the connection off', async () => {
  showCodexSettings(true); await tick(); mocks.set.mockRejectedValueOnce(Error('Update Codex first'));
  mocks.handlers.get('change:#codex-connect')!({}, { checked: true }); await tick(); expect(html()).toContain('Update Codex first');
  mocks.handlers.get('change:#codex-connect')!({}, { checked: false }); await tick(); expect(mocks.set).toHaveBeenLastCalledWith(false);
});
