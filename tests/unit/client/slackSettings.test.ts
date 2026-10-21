import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), disconnect: vi.fn(), test: vi.fn(), toast: vi.fn(), handlers: new Map<string, Function>() }));
vi.mock('kerfjs', async original => ({ ...await original<any>(), delegate: (_root: any, event: string, selector: string, fn: Function) => { mocks.handlers.set(`${event}:${selector}`, fn); } }));
vi.mock('../../../src/api/slack-reactions.js', () => ({ getSlackSettings: mocks.get, saveSlackSettings: mocks.save, disconnectSlack: mocks.disconnect, testSlackReaction: mocks.test }));
vi.mock('../../../src/client/toast.js', () => ({ showToast: mocks.toast }));
vi.mock('../../../src/client/dom.js', () => ({ asInput: (el: any) => el }));
import { bindSlackReactions, loadSlackReactions, renderSlackReactions, resetSlackReactions } from '../../../src/client/settings/slackReactions.js';
const defaults = () => ({ connected: false, keychainAvailable: true, workspace: '', user: '', settings: { provider: 'token', enabled: false, approvedEmoji: 'stamp-approved', changesEmoji: 'request-changes' } });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const html = () => String(renderSlackReactions());
const trigger = (key: string, el = {}) => mocks.handlers.get(key)!({}, el);
beforeEach(() => {
  resetSlackReactions(); mocks.handlers.clear(); mocks.get.mockReset().mockResolvedValue(defaults()); mocks.toast.mockReset();
  mocks.save.mockReset().mockImplementation(async ({ settings }) => ({ ...defaults(), connected: true, settings }));
  mocks.test.mockReset();
  mocks.disconnect.mockReset().mockResolvedValue(defaults()); bindSlackReactions({} as any);
});
it('is off by default with configurable emoji names and a masked connection field', async () => {
  loadSlackReactions(); await tick();
  expect(html()).toContain('React to PR reviews in Slack');
  expect(html()).toContain('stamp-approved'); expect(html()).toContain('request-changes');
  expect(html()).not.toMatch(/id="slack-reactions-enabled"[^>]*checked/); expect(html()).toContain('type="password"');
  expect(mocks.save).not.toHaveBeenCalled();
});
it('saves only on request, clears the entered token on success, and disconnects', async () => {
  loadSlackReactions(); await tick();
  trigger('change:#slack-reactions-enabled', { checked: true });
  trigger('input:#slack-approved-emoji', { value: 'thumbsup' });
  trigger('input:#slack-user-token', { value: 'fixture-token' });
  expect(mocks.save).not.toHaveBeenCalled(); trigger('click:#slack-reactions-save'); await tick();
  expect(mocks.save).toHaveBeenCalledWith({ settings: { provider: 'token', enabled: true, approvedEmoji: 'thumbsup', changesEmoji: 'request-changes' }, token: 'fixture-token' });
  expect(html()).not.toContain('fixture-token'); expect(html()).toContain('Disconnect Slack');
  trigger('click:#slack-disconnect'); await tick();
  expect(html()).not.toMatch(/id="slack-reactions-enabled"[^>]*checked/); expect(mocks.disconnect).toHaveBeenCalledOnce();
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
it('keeps GitHub separate, provides an exclusive connection choice and clears its token on switch', async () => {
  loadSlackReactions(); await tick();
  expect(html()).toContain('SLACK.md'); expect(html()).toContain('role="radiogroup"');
  trigger('input:#slack-user-token', { value: 'fixture-token' });
  trigger('change:[name="slack-provider"]', { value: 'claude' });
  expect(html()).not.toContain('type="password"'); expect(html()).not.toContain('fixture-token');
  trigger('click:#slack-reactions-save'); await tick();
  expect(mocks.save).toHaveBeenLastCalledWith({ settings: { provider: 'claude', enabled: false, approvedEmoji: 'stamp-approved', changesEmoji: 'request-changes' } });
});
it('tests only on request and displays a confirmation below the URL after a real success', async () => {
  loadSlackReactions(); await tick(); expect(html()).not.toContain('id="slack-test-url"');
  trigger('change:#slack-reactions-enabled', { checked: true });
  trigger('input:#slack-test-url', { value: 'https://example.slack.com/archives/C123/p1790000000123456' });
  let finish!: Function;
  mocks.test.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  trigger('click:#slack-test-reaction'); trigger('click:#slack-test-reaction');
  expect(mocks.test).toHaveBeenCalledOnce(); expect(html()).toContain('Testing…'); expect(html()).not.toContain('slack-test-success');
  finish({ settings: { ...defaults(), connected: true, settings: { ...defaults().settings, enabled: true } }, message: 'Connection working — your reaction is on the Slack message.' }); await tick();
  expect(html().indexOf('slack-test-success')).toBeGreaterThan(html().indexOf('id="slack-test-url"'));
  expect(html()).toContain('Connection working');
  trigger('input:#slack-test-url', { value: 'https://example.slack.com/archives/COTHER/p1790000000123456' });
  expect(html()).not.toContain('Connection working');
});
it('never shows success for a failed or stale test', async () => {
  loadSlackReactions(); await tick(); trigger('change:#slack-reactions-enabled', { checked: true });
  mocks.test.mockRejectedValueOnce(new Error('Emoji unavailable'));
  trigger('click:#slack-test-reaction'); await tick();
  expect(html()).toContain('Emoji unavailable'); expect(html()).not.toContain('slack-test-success');
  let finish!: Function;
  mocks.test.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  trigger('click:#slack-test-reaction'); resetSlackReactions(); loadSlackReactions(); await tick();
  finish({ settings: defaults(), message: 'old success' }); await tick();
  expect(html()).not.toContain('old success');
});
it('finishes a silently skipped test without an error, toast or success check', async () => {
  loadSlackReactions(); await tick(); trigger('change:#slack-reactions-enabled', { checked: true });
  mocks.test.mockResolvedValueOnce({ settings: { ...defaults(), settings: { ...defaults().settings, enabled: true } }, message: '' });
  trigger('click:#slack-test-reaction'); await tick();
  expect(html()).not.toContain('slack-test-success');
  expect(html()).not.toContain('role="alert"');
  expect(html()).not.toContain('Testing…');
  expect(mocks.toast).not.toHaveBeenCalled();
});
