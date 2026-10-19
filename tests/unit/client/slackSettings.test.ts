import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), disconnect: vi.fn(), toast: vi.fn(), handlers: new Map<string, Function>() }));
vi.mock('kerfjs', async original => ({ ...await original<any>(), delegate: (_root: any, event: string, selector: string, fn: Function) => { mocks.handlers.set(`${event}:${selector}`, fn); } }));
vi.mock('../../../src/api/slack-reactions.js', () => ({ getSlackSettings: mocks.get, saveSlackSettings: mocks.save, disconnectSlack: mocks.disconnect }));
vi.mock('../../../src/client/toast.js', () => ({ showToast: mocks.toast }));
vi.mock('../../../src/client/dom.js', () => ({ asInput: (el: any) => el }));
import { bindSlackReactions, loadSlackReactions, renderSlackReactions, resetSlackReactions } from '../../../src/client/settings/slackReactions.js';
const defaults = () => ({ connected: false, keychainAvailable: true, workspace: '', user: '', settings: { enabled: false, approvedEmoji: 'stamp-approved', changesEmoji: 'request-changes' } });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const html = () => String(renderSlackReactions());
const trigger = (key: string, el = {}) => mocks.handlers.get(key)!({}, el);
beforeEach(() => {
  resetSlackReactions(); mocks.handlers.clear(); mocks.get.mockReset().mockResolvedValue(defaults()); mocks.toast.mockReset();
  mocks.save.mockReset().mockImplementation(async ({ settings }) => ({ ...defaults(), connected: true, settings }));
  mocks.disconnect.mockReset().mockResolvedValue(defaults()); bindSlackReactions({} as any);
});
it('is off by default with configurable emoji names and a masked connection field', async () => {
  loadSlackReactions(); await tick();
  expect(html()).toContain('React to PR reviews in Slack');
  expect(html()).toContain('stamp-approved'); expect(html()).toContain('request-changes');
  expect(html()).not.toContain(' checked'); expect(html()).toContain('type="password"');
  expect(mocks.save).not.toHaveBeenCalled();
});
it('saves only on request, clears the entered token on success, and disconnects', async () => {
  loadSlackReactions(); await tick();
  trigger('change:#slack-reactions-enabled', { checked: true });
  trigger('input:#slack-approved-emoji', { value: 'thumbsup' });
  trigger('input:#slack-user-token', { value: 'fixture-token' });
  expect(mocks.save).not.toHaveBeenCalled(); trigger('click:#slack-reactions-save'); await tick();
  expect(mocks.save).toHaveBeenCalledWith({ settings: { enabled: true, approvedEmoji: 'thumbsup', changesEmoji: 'request-changes' }, token: 'fixture-token' });
  expect(html()).not.toContain('fixture-token'); expect(html()).toContain('Disconnect Slack');
  trigger('click:#slack-disconnect'); await tick();
  expect(html()).not.toContain(' checked'); expect(mocks.disconnect).toHaveBeenCalledOnce();
});
it('keeps errors visible and ignores responses from a closed settings dialog', async () => {
  loadSlackReactions(); await tick(); mocks.save.mockRejectedValueOnce(new Error('Emoji name invalid'));
  trigger('click:#slack-reactions-save'); await tick(); expect(html()).toContain('Emoji name invalid');
  let finish!: Function;
  mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  trigger('click:#slack-reactions-save'); resetSlackReactions(); loadSlackReactions(); await tick();
  finish({ ...defaults(), connected: true, user: 'stale-user' }); await tick();
  expect(html()).not.toContain('stale-user');
});
