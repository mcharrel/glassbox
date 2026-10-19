import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { PullRef, PullTab } from '../api/workspace.js';
import { parseDeploymentOutput } from './deployment-output.js';
import { closingTabs } from './lifecycle.js';
import { saveWorkspace, workspaceData } from './storage.js';

const exec = promisify(execFile);
const jobs = new Map<PullTab, { controller: AbortController; promise: Promise<void> }>();
const REFRESH_MS = 300_000;
let commandQueue = Promise.resolve();

async function runDevflow(ref: PullRef, services: string[], signal: AbortSignal): Promise<string> {
  const previous = commandQueue;
  let release!: () => void;
  commandQueue = new Promise(resolve => { release = resolve; });
  try {
    await previous;
    signal.throwIfAborted();
    const { stdout } = await exec('ddr', ['devflow', '--no-interactive', 'whereismycode',
      '--pr', `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`,
      ...services.flatMap(service => ['--service', service])],
    { timeout: 90_000, maxBuffer: 1024 * 1024, signal,
      env: { ...process.env, DEVFLOW_RENDER_TYPE: 'GITHUB' } });
    return stdout;
  } catch (error) {
    if (signal.aborted) throw error;
    // CLI failures can contain authentication URLs or tokens; never persist raw output.
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      throw new Error('Install ddr to see Devflow deployment status.', { cause: error });
    throw new Error('Couldn’t refresh deployments. Check your ddr sign-in and connection, then press Cmd/Ctrl+R.', { cause: error });
  } finally { release(); }
}
export async function loadDeploymentTargets(ref: PullRef, signal: AbortSignal) {
  let result = parseDeploymentOutput(await runDevflow(ref, [], signal));
  if (result.services.length) {
    if (result.services.length > 100) throw new Error('Devflow reported too many services to check automatically.');
    result = parseDeploymentOutput(await runDevflow(ref, result.services, signal));
    if (result.services.length) throw new Error('Devflow could not select services for this PR.');
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
    tab.deployment.message = 'Deployment lookup cancelled. Press Cmd/Ctrl+R to retry.';
  }
}
export function stopDeployments(): void { for (const job of jobs.values()) job.controller.abort(); }
export function refreshDeployment(tab: PullTab, force = false): Promise<void> {
  if (!current(tab)) { cancelDeployment(tab); return Promise.resolve(); }
  // Devflow is organisation-specific; do not send unrelated PRs to it.
  if (!['ddoghq', 'datadog'].includes(tab.ref.owner.toLowerCase())) {
    tab.deployment = { status: 'unavailable', targets: [], updatedAt: 0, attemptedAt: Date.now(),
      message: 'Deployment tracking is available for Devflow repositories.' };
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
  const promise = loadDeploymentTargets(tab.ref, controller.signal).then(targets => {
    if (current(tab) && !controller.signal.aborted)
      tab.deployment = { targets, status: 'ready', updatedAt: Date.now(), attemptedAt };
  }).catch((error: unknown) => {
    if (current(tab) && !controller.signal.aborted && tab.deployment) {
      tab.deployment.status = 'error';
      tab.deployment.message = error instanceof Error ? error.message : 'Couldn’t refresh deployments.';
    }
  }).finally(() => {
    jobs.delete(tab);
    if (current(tab) && !controller.signal.aborted) saveWorkspace();
  });
  jobs.set(tab, { controller, promise });
  return promise;
}
