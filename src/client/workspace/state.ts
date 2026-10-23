import { batch, signal } from 'kerfjs';

import {
  changeWorkspace,
  getWorkspace,
  type PullTab,
  type Workspace,
  type WorkspaceMutation,
} from '../../api/workspace.js';
import { showToast } from '../toast.js';

export const workspace = signal<Workspace>({ tabs: [], active: null });
export const addingPull = signal(false);
export const workspaceLoaded = signal(false);
export const refreshingPulls = signal<ReadonlySet<string>>(new Set());
export const mergingPulls = signal<ReadonlySet<string>>(new Set());
export const closingPulls = signal<ReadonlySet<string>>(new Set());
export const reviewRetry = signal(0);
export const reviewSessionKey = (tab: PullTab): string => `${tab.key}:${tab.reviewId ?? ''}:${tab.reviewedBase}:${tab.reviewedHead}${tab.checkoutEvicted ? ':expired' : ''}`;
export const reviewLoadState = signal<{ key: string; status: 'loading' | 'ready' | 'error'; error: string | null }>({
  key: '', status: 'loading', error: null,
});
export function activeReviewReady(): boolean {
  const tab = activeTab();
  return tab !== undefined && !tab.checkoutEvicted && tab.reviewId !== null && reviewLoadState.value.key === reviewSessionKey(tab)
    && reviewLoadState.value.status === 'ready';
}
interface PendingClose { tab: PullTab; order: string[] }
const pendingCloses = signal<ReadonlyMap<string, PendingClose>>(new Map());
// Retain drafts and reading state only until deletion succeeds or rolls back.
export function retainedTabs(): PullTab[] {
  return [...workspace.value.tabs, ...[...pendingCloses.value.values()].map(close => close.tab)];
}
let mutationVersion = 0;
let closeVersion = 0;
function receive(state: Workspace, preserveSelection: boolean): void {
  workspaceLoaded.value = true;
  const local = workspace.value;
  const openedExternally = (state.externalSelection ?? 0) !== (local.externalSelection ?? 0);
  if (openedExternally) addingPull.value = false;
  const tabs = state.tabs.filter(tab => !pendingCloses.value.has(tab.key));
  const selected = preserveSelection && !openedExternally ? local.active : state.active;
  workspace.value = { ...state,
    active: tabs.some(tab => tab.key === selected) ? selected : tabs.find(tab => tab.key === state.active)?.key ?? tabs.at(0)?.key ?? null,
    tabs: tabs.map(tab => ({ ...tab, view: local.tabs.find(item => item.key === tab.key)?.view ?? tab.view })),
  };
}
export function activeTab(): PullTab | undefined {
  return workspace.value.tabs.find((t) => t.key === workspace.value.active);
}
export async function refreshWorkspace(preserveSelection = true): Promise<void> {
  const version = mutationVersion;
  const closed = closeVersion;
  const state = await getWorkspace();
  if (version !== mutationVersion || closed !== closeVersion) return;
  // Keep editors intact while background synchronization continues on the server.
  if (preserveSelection && (
    document.querySelector(
      '.pr-tab.dragging, .pr-title-input, .request-changes-form, .pr-description-editor',
    ) !== null ||
    [...document.querySelectorAll('textarea')].some((input) => input.value.length > 0 && !input.disabled)
  ))
    return;
  receive(state, preserveSelection);
}
function finishClose(key: string, error?: string): void {
  const saved = pendingCloses.value.get(key);
  // Invalidate snapshots requested before cleanup finished, including background polls.
  closeVersion++;
  batch(() => {
    if (saved && error !== undefined && !workspace.value.tabs.some(tab => tab.key === key)) {
      const tabs = [...workspace.value.tabs];
      const next = saved.order.slice(saved.order.indexOf(key) + 1).find(item => tabs.some(tab => tab.key === item));
      const index = next === undefined ? tabs.length : tabs.findIndex(tab => tab.key === next);
      tabs.splice(index, 0, { ...saved.tab, error });
      workspace.value = { ...workspace.value, tabs, active: workspace.value.active ?? key };
    }
    pendingCloses.value = new Map([...pendingCloses.value].filter(([item]) => item !== key));
    closingPulls.value = new Set([...closingPulls.value].filter(item => item !== key));
  });
}
export async function mutate(input: WorkspaceMutation): Promise<boolean> {
  if (input.op === 'close') {
    if (closingPulls.value.has(input.key)) return false;
    const local = workspace.value;
    const tab = local.tabs.find(item => item.key === input.key);
    if (!tab) return false;
    batch(() => {
      pendingCloses.value = new Map([...pendingCloses.value, [input.key, { tab, order: local.tabs.map(item => item.key) }]]);
      closingPulls.value = new Set([...closingPulls.value, input.key]);
      const tabs = local.tabs.filter(item => item !== tab);
      workspace.value = { ...local, tabs, active: local.active === input.key ? tabs.at(0)?.key ?? null : local.active };
    });
  }
  if (input.op === 'merge') {
    if (mergingPulls.value.has(input.key)) return false;
    mergingPulls.value = new Set([...mergingPulls.value, input.key]);
  }
  const version = ++mutationVersion;
  const closed = closeVersion;
  try {
    const result = await changeWorkspace(input);
    const fresh = closed === closeVersion;
    if (input.op === 'close') finishClose(input.key);
    if (version === mutationVersion && fresh) receive(result, input.op !== 'open');
    else if (!fresh || input.op === 'close' || input.op === 'merge')
      void refreshWorkspace(version !== mutationVersion || input.op !== 'open').catch(() => {});
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed';
    if (input.op === 'close') finishClose(input.key, message);
    showToast(input.op === 'close' ? `Couldn’t close ${input.key}: ${message}` : message);
    return false;
  } finally {
    if (input.op === 'merge') mergingPulls.value = new Set([...mergingPulls.value].filter(key => key !== input.key));
  }
}
export function setFileView(): void {
  const tab = activeTab();
  if (!tab || tab.view === 'file') return;
  tab.view = 'file';
  workspace.value = { ...workspace.value };
  void mutate({ op: 'view', key: tab.key, view: 'file' });
}
