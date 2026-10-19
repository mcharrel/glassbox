import type { SafeHtml } from 'kerfjs';
import { delegate, signal } from 'kerfjs';

import type { CompanyDeployments } from '../../api/company-deployments.js';
import { getCompanyDeployments, saveCompanyDeployments } from '../../api/company-deployments.js';
import { IconSliders } from '../../icons.js';
import { asInput, asSelect, asTextarea } from '../dom.js';
import { showToast } from '../toast.js';
import type { Tab } from './tabContext.js';

const state = signal<{ settings: CompanyDeployments | null; organizations: string; error: string; saving: boolean }>({
  settings: null, organizations: '', error: '', saving: false,
});
let generation = 0;
let loading = false;
export function resetCompanyTab(): void {
  generation++;
  loading = false;
  state.value = { settings: null, organizations: '', error: '', saving: false };
}
export function loadCompanyTab(): void {
  if (state.value.settings || loading) return;
  loading = true;
  const current = generation;
  void getCompanyDeployments().then(settings => {
    if (current === generation) state.value = { settings, organizations: settings.organizations.join(', '), error: '', saving: false };
  }).catch(() => {
    if (current === generation) state.value = { ...state.value, error: 'Couldn’t load company settings. Try again.' };
  }).finally(() => { if (current === generation) loading = false; });
}

export function renderCompanyDeployments(settings: CompanyDeployments, organizations: string, saving: boolean): SafeHtml {
  return <fieldset className="company-deployments" disabled={saving}>
    <h3 className="settings-heading">Deployments</h3>
    <p className="settings-disclaimer">Connect your company’s deployment source. These settings stay on this computer.</p>
    <label className="settings-checkbox"><input id="company-deployments-enabled" type="checkbox" checked={settings.enabled} /> Enable deployment tracking</label>
    <label className="settings-label" htmlFor="company-deployments-organizations">GitHub organizations</label>
    <input className="settings-input" id="company-deployments-organizations" value={organizations} placeholder="example-org, another-org" autoComplete="off" />
    <p className="settings-disclaimer">Only merged PRs in these organizations are sent to your source.</p>
    <label className="settings-label" htmlFor="company-deployments-source">Source</label>
    <select className="settings-select" id="company-deployments-source">
      <option value="command" selected={settings.source === 'command'}>Local command</option>
      <option value="endpoint" selected={settings.source === 'endpoint'}>HTTP endpoint</option>
    </select>
    {settings.source === 'command' ? <>
      <label className="settings-label" htmlFor="company-deployments-command">Command</label>
      <textarea className="settings-input" id="company-deployments-command" rows={7} spellCheck="false" placeholder={'deployment-status --pr "$REV_PR_URL"'}>{settings.command}</textarea>
      <p className="settings-disclaimer">Runs locally in a shell. Use <code>$REV_PR_URL</code> for the PR link and <code>$REV_SERVICES</code> for suggested services (one per line, initially empty). Print the deployment report to standard output.</p>
    </> : <>
      <label className="settings-label" htmlFor="company-deployments-endpoint">Endpoint URL</label>
      <input className="settings-input" id="company-deployments-endpoint" value={settings.endpoint} placeholder="https://deployments.example/status?pr={pr_url}&amp;services={services}" autoComplete="off" spellCheck="false" />
      <p className="settings-disclaimer">GET request. Placeholders: <code>{'{pr_url}'}</code>, <code>{'{owner}'}</code>, <code>{'{repo}'}</code>, <code>{'{number}'}</code>, <code>{'{services}'}</code> (JSON array). Values are URL-encoded.</p>
      <label className="settings-label" htmlFor="company-deployments-authorization">Authorization header (optional)</label>
      <input className="settings-input" id="company-deployments-authorization" type="password" value={settings.authorization} autoComplete="off" placeholder="Bearer …" />
    </>}
    <p className="settings-disclaimer">Accepts a text or Markdown report grouped by service, with Datacenter, Env, Namespace and Deployed columns. Refreshes every five minutes or with Cmd/Ctrl+R.</p>
    <button className="btn btn-primary" id="company-deployments-save">{saving ? 'Saving…' : 'Save deployments'}</button>
  </fieldset>;
}

export function bindCompanyTab(root: HTMLElement): void {
  const update = (patch: Partial<CompanyDeployments>) => {
    const current = state.value;
    if (current.settings && !current.saving) state.value = { ...current, settings: { ...current.settings, ...patch }, error: '' };
  };
  void delegate(root, 'change', '#company-deployments-enabled', (_e, el) => { update({ enabled: asInput(el).checked }); });
  void delegate(root, 'change', '#company-deployments-source', (_e, el) => {
    const value = asSelect(el).value;
    if (value === 'command' || value === 'endpoint') update({ source: value });
  });
  void delegate(root, 'input', '#company-deployments-organizations', (_e, el) => {
    state.value = { ...state.value, organizations: asInput(el).value, error: '' };
  });
  void delegate(root, 'input', '#company-deployments-command', (_e, el) => { update({ command: asTextarea(el).value }); });
  void delegate(root, 'input', '#company-deployments-endpoint', (_e, el) => { update({ endpoint: asInput(el).value }); });
  void delegate(root, 'input', '#company-deployments-authorization', (_e, el) => { update({ authorization: asInput(el).value }); });
  void delegate(root, 'click', '#company-deployments-retry', loadCompanyTab);
  void delegate(root, 'click', '#company-deployments-save', () => {
    const current = state.value;
    if (!current.settings || current.saving) return;
    const version = generation;
    state.value = { ...current, saving: true, error: '' };
    void saveCompanyDeployments({ ...current.settings, organizations: current.organizations.split(/[\s,]+/).filter(Boolean) }).then(settings => {
      if (version !== generation) return;
      state.value = { settings, organizations: settings.organizations.join(', '), saving: false, error: '' };
      showToast('Deployment settings saved');
    }).catch((error: unknown) => {
      if (version === generation) state.value = { ...state.value, saving: false, error: error instanceof Error ? error.message : 'Couldn’t save deployment settings.' };
    });
  });
}

export const companyTab: Tab = {
  id: 'company', label: 'My company', icon: <IconSliders />,
  render: () => {
    const { settings, organizations, saving, error } = state.value;
    return <>
      {settings ? renderCompanyDeployments(settings, organizations, saving) : error
        ? <button className="btn" id="company-deployments-retry">Retry</button>
        : <p role="status">Loading company settings…</p>}
      {error && <p className="settings-disclaimer" role="alert">{error}</p>}
    </>;
  },
};
