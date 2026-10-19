import { delegate, signal } from 'kerfjs';

import { disconnectSlack, getSlackSettings, saveSlackSettings, type SlackPreferences, type SlackSettings } from '../../api/slack-reactions.js';
import { asInput } from '../dom.js';
import { showToast } from '../toast.js';

const state = signal<{ data: SlackSettings | null; token: string; saving: boolean; error: string }>({ data: null, token: '', saving: false, error: '' });
let generation = 0;
let loading = false;
export function resetSlackReactions(): void {
  generation++; loading = false;
  state.value = { data: null, token: '', saving: false, error: '' };
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
export function renderSlackReactions() {
  const { data, token, saving, error } = state.value;
  return <>
    <div className="settings-divider"></div>
    <h3 className="settings-heading">Slack reactions</h3>
    {data ? <fieldset className="slack-reaction-settings" disabled={saving}>
      <label className="settings-checkbox"><input id="slack-reactions-enabled" type="checkbox" checked={data.settings.enabled} /> React to PR reviews in Slack</label>
      <p className="settings-hint">After you approve or request changes, add your reaction to Slack messages linking to that PR. No messages are posted.</p>
      <label className="settings-label" htmlFor="slack-approved-emoji">Approval emoji</label>
      <input className="settings-input" id="slack-approved-emoji" value={data.settings.approvedEmoji} placeholder="stamp-approved" spellCheck="false" />
      <label className="settings-label" htmlFor="slack-changes-emoji">Changes requested emoji</label>
      <input className="settings-input" id="slack-changes-emoji" value={data.settings.changesEmoji} placeholder="request-changes" spellCheck="false" />
      <p className="settings-hint">Use emoji names from your workspace, with or without colons. “Make explanations more human” uses the changes-requested emoji.</p>
      {data.connected && <p className="settings-hint">Connected{data.user && ` as ${data.user}`}{data.workspace && ` in ${data.workspace}`}.</p>}
      <label className="settings-label" htmlFor="slack-user-token">{data.connected ? 'Replace Slack connection (optional)' : 'Slack user OAuth token'}</label>
      <input className="settings-input" id="slack-user-token" type="password" autoComplete="off" spellCheck="false" value={token} placeholder={data.connected ? 'Leave blank to keep your connection' : 'xoxp-…'} disabled={!data.keychainAvailable} />
      <p className="settings-hint">Your Slack app needs the user permissions <code>search:read</code> and <code>reactions:write</code>. The token stays in your system keychain.</p>
      {!data.keychainAvailable && <p role="alert">Install a system keychain to connect Slack.</p>}
      <button className="btn btn-primary" id="slack-reactions-save">{saving ? 'Saving…' : 'Save Slack settings'}</button>
      {data.connected && <button className="btn btn-sm" id="slack-disconnect">Disconnect Slack</button>}
    </fieldset> : error ? <button className="btn" id="slack-settings-retry">Retry</button> : <p role="status">Loading Slack settings…</p>}
    {error && <p className="settings-hint" role="alert">{error}</p>}
  </>;
}
export function bindSlackReactions(root: HTMLElement): void {
  const update = (patch: Partial<SlackPreferences>) => {
    const { data, saving } = state.value;
    if (data && !saving) state.value = { ...state.value, data: { ...data, settings: { ...data.settings, ...patch } }, error: '' };
  };
  void delegate(root, 'change', '#slack-reactions-enabled', (_event, el) => { update({ enabled: asInput(el).checked }); });
  void delegate(root, 'input', '#slack-approved-emoji', (_event, el) => { update({ approvedEmoji: asInput(el).value }); });
  void delegate(root, 'input', '#slack-changes-emoji', (_event, el) => { update({ changesEmoji: asInput(el).value }); });
  void delegate(root, 'input', '#slack-user-token', (_event, el) => {
    if (!state.value.saving) state.value = { ...state.value, token: asInput(el).value, error: '' };
  });
  const save = (disconnect: boolean) => {
    const { data, token, saving } = state.value;
    if (!data || saving) return;
    const version = generation;
    state.value = { ...state.value, saving: true, error: '' };
    void (disconnect ? disconnectSlack() : saveSlackSettings({ settings: data.settings, ...(token.trim() ? { token: token.trim() } : {}) })).then(result => {
      if (version !== generation) return;
      state.value = { data: result, token: '', saving: false, error: '' };
      showToast(disconnect ? 'Slack disconnected' : 'Slack settings saved');
    }).catch((error: unknown) => {
      if (version === generation) state.value = { ...state.value, saving: false, error: error instanceof Error ? error.message : 'Couldn’t save Slack settings.' };
    });
  };
  void delegate(root, 'click', '#slack-reactions-save', () => { save(false); });
  void delegate(root, 'click', '#slack-disconnect', () => { save(true); });
  void delegate(root, 'click', '#slack-settings-retry', loadSlackReactions);
}
