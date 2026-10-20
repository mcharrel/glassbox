import { delegate, signal } from 'kerfjs';
import { z } from 'zod';

import { getGitHubAccounts, type GitHubAccountSettings, saveGitHubAccounts } from '../../api/github-accounts.js';
import { IconUser } from '../../icons.js';
import { asInput, asSelect } from '../dom.js';
import { getTauriInvoke } from '../tauri.js';
import { refreshWorkspace } from '../workspace/state.js';
import type { Tab } from './tabContext.js';

const LinksSchema = z.object({ supported: z.boolean(), enabled: z.boolean(), registered: z.boolean(), browser: z.string(), error: z.string().optional() });
type Row = { id: number; organization: string; user: string };
const state = signal<{ accounts: GitHubAccountSettings | null; rows: Row[]; links: z.infer<typeof LinksSchema> | null; saving: boolean; linking: boolean; error: string }>({ accounts: null, rows: [], links: null, saving: false, linking: false, error: '' });
let generation = 0;
let sequence = 0;
let loading = false;
export function resetGitHubTab(): void {
  generation++; loading = false;
  state.value = { accounts: null, rows: [], links: null, saving: false, linking: false, error: '' };
}
export function loadGitHubTab(): void {
  if (loading) return;
  loading = true;
  const version = generation;
  void getGitHubAccounts().then(accounts => {
    if (version === generation) state.value = { ...state.value, accounts,
      rows: Object.entries(accounts.settings.organizations).map(([organization, user]) => ({ id: ++sequence, organization, user })) };
  }).catch(() => {
    if (version === generation) state.value = { ...state.value, error: 'Couldn’t read GitHub accounts. Sign in with gh auth login, then reopen Settings.' };
  });
  const invoke = getTauriInvoke();
  if (invoke) void invoke('get_pr_link_routing').then(value => {
    if (version === generation) state.value = { ...state.value, links: LinksSchema.parse(value) };
  }).catch(() => {
    if (version === generation) state.value = { ...state.value, error: 'Couldn’t check macOS link routing.' };
  });
}
function saveAccounts(): void {
  const current = state.value;
  if (!current.accounts || current.saving) return;
  const rows = current.rows.filter(row => row.organization.trim() !== '');
  if (new Set(rows.map(row => row.organization.trim().toLowerCase())).size !== rows.length) {
    state.value = { ...current, error: 'Use each organization only once.' }; return;
  }
  const version = generation;
  state.value = { ...current, saving: true, error: '' };
  void saveGitHubAccounts({ defaultUser: current.accounts.settings.defaultUser,
    organizations: Object.fromEntries(rows.map(row => [row.organization.trim(), row.user])) }).then(accounts => {
    if (version === generation) state.value = { ...state.value, accounts, saving: false };
    void refreshWorkspace();
  }).catch((error: unknown) => {
    if (version === generation) state.value = { ...state.value, saving: false, error: error instanceof Error ? error.message : 'Couldn’t save accounts.' };
  });
}
function setLinks(enabled: boolean): void {
  const invoke = getTauriInvoke();
  if (!invoke || state.value.linking) return;
  const version = generation;
  state.value = { ...state.value, linking: true, error: '' };
  void invoke('set_pr_link_routing', { enabled }).then(value => {
    if (version === generation) state.value = { ...state.value, linking: false, links: LinksSchema.parse(value) };
  }).catch((error: unknown) => {
    if (version === generation) state.value = { ...state.value, linking: false, error: String(error) };
  });
}
export function bindGitHubTab(root: HTMLElement): void {
  void delegate(root, 'change', '#github-default-user', (_event, el) => {
    const current = state.value;
    if (!current.accounts) return;
    state.value = { ...current, accounts: { ...current.accounts, settings: { ...current.accounts.settings, defaultUser: asSelect(el).value } } };
    saveAccounts();
  });
  void delegate(root, 'input', '[data-github-org]', (_event, el) => {
    const id = Number((el as HTMLElement).dataset.githubOrg);
    state.value = { ...state.value, rows: state.value.rows.map(row => row.id === id ? { ...row, organization: asInput(el).value } : row) };
  });
  void delegate(root, 'change', '[data-github-org]', saveAccounts);
  void delegate(root, 'change', '[data-github-user]', (_event, el) => {
    const id = Number((el as HTMLElement).dataset.githubUser);
    state.value = { ...state.value, rows: state.value.rows.map(row => row.id === id ? { ...row, user: asSelect(el).value } : row) };
    saveAccounts();
  });
  void delegate(root, 'click', '#github-add-organization', () => {
    state.value = { ...state.value, rows: [...state.value.rows, { id: ++sequence, organization: '', user: state.value.accounts?.settings.defaultUser ?? '' }] };
  });
  void delegate(root, 'click', '[data-github-remove]', (_event, el) => {
    const id = Number((el as HTMLElement).dataset.githubRemove);
    state.value = { ...state.value, rows: state.value.rows.filter(row => row.id !== id) };
    saveAccounts();
  });
  void delegate(root, 'change', '#pr-link-routing', (_event, el) => { setLinks(asInput(el).checked); });
  void delegate(root, 'click', '#pr-link-setup', () => { setLinks(true); });
}
export const githubTab: Tab = {
  id: 'github', label: 'GitHub', icon: <IconUser />,
  render: () => {
    const { accounts, rows, links, saving, linking, error } = state.value;
    const users = (selected: string) => <>
      {selected && accounts?.users.includes(selected) !== true && <option value={selected} selected>{selected} (not signed in)</option>}
      {accounts?.users.map(user => <option value={user} selected={user === selected}>{user}</option>)}
    </>;
    return <>
      <h3 className="settings-heading">GitHub accounts</h3>
      <p className="settings-hint">Choose a default account and exceptions for organizations. Saved only on this computer; your terminal’s active account stays unchanged.</p>
      {accounts ? <fieldset disabled={saving} className="github-account-settings">
        <label className="settings-label" htmlFor="github-default-user">Default account</label>
        <select className="settings-select" id="github-default-user">{users(accounts.settings.defaultUser)}</select>
        {rows.map(row => <div className="github-account-row" data-key={row.id}>
          <input className="settings-input" aria-label="GitHub organization" placeholder="Organization" data-github-org={row.id} value={row.organization} />
          <select className="settings-select" aria-label="GitHub account" data-github-user={row.id}>{users(row.user)}</select>
          <button className="btn btn-sm" data-github-remove={row.id} aria-label={`Remove ${row.organization || 'organization'}`}>Remove</button>
        </div>)}
        <button className="btn btn-sm" id="github-add-organization">Add organization</button>
        {saving && <p role="status">Saving…</p>}
      </fieldset> : !error && <p role="status">Loading GitHub accounts…</p>}
      <div className="settings-divider"></div>
      <h3 className="settings-heading">PR links</h3>
      {links?.supported === true ? <>
        <label className="settings-checkbox"><input id="pr-link-routing" type="checkbox" checked={links.enabled} disabled={linking} /> Open PR links in rev</label>
        <p className="settings-hint">PR links from Slack and other apps open here. Other links stay in {links.browser}. Disabling restores your browser.</p>
        {links.enabled && !links.registered && <><p className="settings-hint">Confirm rev Links as your default browser in macOS to activate routing.</p><button className="btn btn-sm" id="pr-link-setup" disabled={linking}>{linking ? 'Waiting for macOS…' : 'Enable in macOS'}</button></>}
        {links.error !== undefined && <p role="alert">{links.error}</p>}
      </> : <p className="settings-hint">Automatic PR link routing is available in the macOS desktop app.</p>}
      {error && <p className="settings-hint" role="alert">{error}</p>}
    </>;
  },
};
