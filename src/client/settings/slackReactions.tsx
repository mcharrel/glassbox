import { attr, delegate, signal } from 'kerfjs';

import { disconnectSlack, getSlackSettings, saveSlackSettings, type SlackPreferences, type SlackSettings,testSlackReaction } from '../../api/slack-reactions.js';
import { IconCheck, IconSlack } from '../../icons.js';
import { asInput } from '../dom.js';
import { showToast } from '../toast.js';
import type { Tab } from './tabContext.js';

const providerChoice = attr('name', 'slack-provider');
const empty = (): { data: SlackSettings | null; token: string; messageUrl: string; saving: boolean; testing: boolean; error: string; testMessage: string } =>
  ({ data: null, token: '', messageUrl: '', saving: false, testing: false, error: '', testMessage: '' });
const state = signal(empty());
let generation = 0;
let loading = false;
export function resetSlackReactions(): void {
  generation++; loading = false;
  state.value = empty();
}
export function loadSlackReactions(): void {
  if (loading || state.value.data) return;
  loading = true;
  const version = generation;
  void getSlackSettings().then(data => {
    if (version === generation) state.value = { ...state.value, data, error: '' };
  }).catch(() => {
    if (version === generation) state.value = { ...state.value, error: 'Couldn’t load Slack settings.' };
  }).finally(() => { if (version === generation) loading = false; });
}
export const slackTab: Tab = { id: 'slack', label: 'Slack', icon: <IconSlack />, render: renderSlackReactions };
export function renderSlackReactions() {
  const { data, token, saving, testing, error, messageUrl, testMessage } = state.value;
  return <>
    <h3 className="settings-heading">Slack connection</h3>
    <p className="settings-hint">Choose the connection you set up. <a href="https://github.com/mcharrel/rev/blob/main/SLACK.md" target="_blank" rel="noopener noreferrer">Slack setup instructions</a></p>
    {data ? <fieldset className="slack-reaction-settings" disabled={saving}>
      <div className="slack-connection-options" role="radiogroup" aria-label="Slack connection">
        <label className="settings-checkbox"><input type="radio" {...providerChoice.attrs} value="token" checked={data.settings.provider === 'token'} /> Slack app (user OAuth token)</label>
        <label className="settings-checkbox"><input type="radio" {...providerChoice.attrs} value="claude" checked={data.settings.provider === 'claude'} /> Claude Code (Slack plugin)</label>
      </div>
      {data.settings.provider === 'token' ? <>
        {data.connected && <p className="settings-hint">Connected{data.user && ` as ${data.user}`}{data.workspace && ` in ${data.workspace}`}.</p>}
        <label className="settings-label" htmlFor="slack-user-token">{data.connected ? 'Replace Slack connection (optional)' : 'Slack user OAuth token'}</label>
        <input className="settings-input" id="slack-user-token" type="password" autoComplete="off" spellCheck="false" value={token} placeholder={data.connected ? 'Leave blank to keep your connection' : 'xoxp-…'} disabled={!data.keychainAvailable} />
        <p className="settings-hint">Requires search:read and reactions:write user permissions. The token stays in your system keychain.</p>
        {!data.keychainAvailable && <p role="alert">Install a system keychain to connect Slack.</p>}
      </> : <p className="settings-hint">Uses the Slack plugin authenticated in your local Claude Code installation. Claude keeps its credentials. Each operation uses your Claude account and can take a few seconds.</p>}
      <div className="settings-divider"></div>
      <label className="settings-checkbox"><input id="slack-reactions-enabled" type="checkbox" checked={data.settings.enabled} /> React to PR reviews in Slack</label>
      <p className="settings-hint">After you approve or request changes, search public and private conversations you can access and add your reaction to messages linking to that PR. No messages are posted.</p>
      <label className="settings-label" htmlFor="slack-approved-emoji">Approval emoji</label>
      <input className="settings-input" id="slack-approved-emoji" value={data.settings.approvedEmoji} placeholder="stamp-approved" spellCheck="false" />
      <label className="settings-label" htmlFor="slack-changes-emoji">Changes requested emoji</label>
      <input className="settings-input" id="slack-changes-emoji" value={data.settings.changesEmoji} placeholder="request-changes" spellCheck="false" />
      <p className="settings-hint">Use emoji names from your workspace, with or without colons. “Make explanations more human” uses the changes-requested emoji.</p>
      <button className="btn btn-primary" id="slack-reactions-save">{saving && !testing ? 'Saving…' : 'Save Slack settings'}</button>
      {data.settings.provider === 'token' && data.connected && <button className="btn btn-sm" id="slack-disconnect">Disconnect Slack</button>}
      {data.settings.enabled && <div className="slack-reaction-test">
        <label className="settings-label" htmlFor="slack-test-url">Test your connection</label>
        <p className="settings-hint">Paste a Slack message link. Testing saves these settings and adds :{data.settings.approvedEmoji.replace(/^:|:$/g, '')}: to that message.</p>
        <div className="slack-test-row"><input className="settings-input" id="slack-test-url" type="url" value={messageUrl} placeholder="https://workspace.slack.com/archives/…" spellCheck="false" /><button className="btn btn-sm" id="slack-test-reaction" disabled={!messageUrl.trim()}>{testing ? 'Testing…' : 'Test reaction'}</button></div>
        {testMessage && <p className="slack-test-success" role="status"><IconCheck />{testMessage}</p>}
      </div>}
    </fieldset> : error ? <button className="btn" id="slack-settings-retry">Retry</button> : <p role="status">Loading Slack settings…</p>}
    {error && <p className="settings-hint" role="alert">{error}</p>}
  </>;
}
export function bindSlackReactions(root: HTMLElement): void {
  const update = (patch: Partial<SlackPreferences>) => {
    const { data, saving } = state.value;
    if (data && !saving) state.value = { ...state.value, data: { ...data, settings: { ...data.settings, ...patch }, ...(patch.provider ? { connected: false, workspace: '', user: '' } : {}) }, error: '', testMessage: '', ...(patch.provider ? { token: '' } : {}) };
  };
  void delegate(root, 'change', providerChoice.selector, (_event, el) => {
    const value = asInput(el).value;
    if (value === 'token' || value === 'claude') update({ provider: value });
  });
  void delegate(root, 'change', '#slack-reactions-enabled', (_event, el) => { update({ enabled: asInput(el).checked }); });
  void delegate(root, 'input', '#slack-approved-emoji', (_event, el) => { update({ approvedEmoji: asInput(el).value }); });
  void delegate(root, 'input', '#slack-changes-emoji', (_event, el) => { update({ changesEmoji: asInput(el).value }); });
  for (const [selector, field] of [['#slack-user-token', 'token'], ['#slack-test-url', 'messageUrl']] as const) {
    void delegate(root, 'input', selector, (_event, el) => {
      if (!state.value.saving) state.value = { ...state.value, [field]: asInput(el).value, error: '', testMessage: '' };
    });
  }
  const save = async (action: 'save' | 'disconnect' | 'test') => {
    const { data, token, saving, messageUrl } = state.value;
    if (!data || saving || (action === 'test' && !data.settings.enabled)) return;
    const version = generation;
    state.value = { ...state.value, saving: true, testing: action === 'test', error: '', testMessage: '' };
    try {
      const body = { settings: data.settings, ...(data.settings.provider === 'token' && token.trim() ? { token: token.trim() } : {}) };
      const test = action === 'test' ? await testSlackReaction({ ...body, messageUrl }) : null;
      const result = test ? test.settings : action === 'disconnect' ? await disconnectSlack() : await saveSlackSettings(body);
      if (version !== generation) return;
      state.value = { ...state.value, data: result, token: '', saving: false, testing: false, error: '', testMessage: test?.message ?? '' };
      if (!test) showToast(action === 'disconnect' ? 'Slack disconnected' : 'Slack settings saved');
    } catch (error: unknown) {
      if (version === generation) state.value = { ...state.value, saving: false, testing: false, error: error instanceof Error ? error.message : 'Couldn’t complete the Slack request.' };
    }
  };
  void delegate(root, 'click', '#slack-reactions-save', () => { void save('save'); });
  void delegate(root, 'click', '#slack-disconnect', () => { void save('disconnect'); });
  void delegate(root, 'click', '#slack-test-reaction', () => { void save('test'); });
  void delegate(root, 'click', '#slack-settings-retry', loadSlackReactions);
}
