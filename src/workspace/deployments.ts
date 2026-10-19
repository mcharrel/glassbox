import type { CompanyDeployments } from '../api/company-deployments.js';
import type { PullRef, PullTab } from '../api/workspace.js';
import { parseDeploymentOutput } from './deployment-output.js';
import { deploymentSettings } from './deployment-settings.js';
import { runDeploymentSource } from './deployment-source.js';
import { closingTabs } from './lifecycle.js';
import { saveWorkspace, workspaceData } from './storage.js';

const jobs = new Map<PullTab, { controller: AbortController; promise: Promise<void> }>();
const REFRESH_MS = 300_000;
let commandQueue = Promise.resolve();

async function querySource(settings: CompanyDeployments, ref: PullRef, services: string[], signal: AbortSignal): Promise<string> {
  const previous = commandQueue;
  let release!: () => void;
  commandQueue = new Promise(resolve => { release = resolve; });
  try {
    await previous;
    signal.throwIfAborted();
    return await runDeploymentSource(settings, ref, services, signal);
  } catch {
    // Reports and transport errors can contain private URLs or credentials; never persist them.
    throw new Error('Couldn’t refresh deployments. Check My company → Deployments in Settings, then press Cmd/Ctrl+R.');
  } finally { release(); }
}
export async function loadDeploymentTargets(settings: CompanyDeployments, ref: PullRef, signal: AbortSignal) {
  let result = parseDeploymentOutput(await querySource(settings, ref, [], signal));
  if (result.services.length) {
    if (result.services.length > 100) throw new Error('The deployment report lists too many services to check automatically.');
    result = parseDeploymentOutput(await querySource(settings, ref, result.services, signal));
    if (result.services.length) throw new Error('The deployment source could not select services for this PR.');
  }
  return result.targets;
}
function current(tab: PullTab): boolean {
  return workspaceData().tabs.includes(tab) && !closingTabs.has(tab) && tab.info?.state === 'MERGED';
}
export function cancelDeployment(tab: PullTab): void {
  jobs.get(tab)?.controller.abort();
  if (tab.deployment?.status === 'loading') {
    tab.deployment.status = 'error';
    tab.deployment.attemptedAt = 0;
    tab.deployment.message = 'Deployment lookup canceled. Press Cmd/Ctrl+R to retry.';
  }
}
export function stopDeployments(): void { for (const job of jobs.values()) job.controller.abort(); }
export function refreshDeployment(tab: PullTab, force = false): Promise<void> {
  if (!current(tab)) { cancelDeployment(tab); return Promise.resolve(); }
  const settings = deploymentSettings();
  if (!settings.enabled || !settings.organizations.some(owner => owner.toLowerCase() === tab.ref.owner.toLowerCase())) {
    cancelDeployment(tab);
    tab.deployment = { status: 'unavailable', targets: [], updatedAt: 0, attemptedAt: Date.now(),
      message: settings.enabled ? 'Deployment tracking is not configured for this organization.'
        : 'Configure deployments in Settings → My company → Deployments.' };
    saveWorkspace();
    return Promise.resolve();
  }
  const running = jobs.get(tab);
  if (running) return running.promise;
  if (!force && tab.deployment && Date.now() - tab.deployment.attemptedAt < REFRESH_MS) return Promise.resolve();
  const controller = new AbortController();
  const attemptedAt = Date.now();
  tab.deployment = { targets: tab.deployment?.targets ?? [], updatedAt: tab.deployment?.updatedAt ?? 0,
    attemptedAt, status: 'loading' };
  saveWorkspace();
  const promise = loadDeploymentTargets(settings, tab.ref, controller.signal).then(targets => {
    if (current(tab) && !controller.signal.aborted)
      tab.deployment = { targets, status: 'ready', updatedAt: Date.now(), attemptedAt };
  }).catch((error: unknown) => {
    if (current(tab) && !controller.signal.aborted && tab.deployment) {
      tab.deployment.status = 'error';
      tab.deployment.message = error instanceof Error ? error.message : 'Couldn’t refresh deployments.';
    }
  }).finally(() => {
    if (jobs.get(tab)?.controller === controller) jobs.delete(tab);
    if (current(tab) && !controller.signal.aborted) saveWorkspace();
  });
  jobs.set(tab, { controller, promise });
  return promise;
}

export function resetDeployments(): void {
  stopDeployments();
  jobs.clear();
  for (const tab of workspaceData().tabs) {
    delete tab.deployment;
    void refreshDeployment(tab, true);
  }
  saveWorkspace();
}
