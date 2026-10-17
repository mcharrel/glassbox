import { signal } from 'kerfjs';

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
let mutationVersion = 0;
function receive(state: Workspace, preserveSelection: boolean): void {
  const local = workspace.value;
  workspace.value = { ...state,
    active: preserveSelection && state.tabs.some(tab => tab.key === local.active) ? local.active : state.active,
    tabs: state.tabs.map(tab => ({ ...tab, view: local.tabs.find(item => item.key === tab.key)?.view ?? tab.view })),
  };
}
export function activeTab(): PullTab | undefined {
  return workspace.value.tabs.find((t) => t.key === workspace.value.active);
}
export async function refreshWorkspace(): Promise<void> {
  const version = mutationVersion;
  const state = await getWorkspace();
  if (version !== mutationVersion) return;
  // Keep editors intact while background synchronization continues on the server.
  if (
    document.querySelector(
      '.pr-tab.dragging, .pr-title-input, .pr-message-editor, .request-changes-form, .pr-description-editor',
    ) !== null ||
    [...document.querySelectorAll('textarea')].some((input) => input.value.length > 0 && !input.disabled)
  )
    return;
  receive(state, true);
}
export async function mutate(input: WorkspaceMutation): Promise<boolean> {
  const version = ++mutationVersion;
  try {
    const result = await changeWorkspace(input);
    if (version === mutationVersion) receive(result, input.op !== 'open' && input.op !== 'close');
    return true;
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Request failed');
    return false;
  }
}
export function setFileView(): void {
  const tab = activeTab();
  if (!tab || tab.view === 'file') return;
  tab.view = 'file';
  workspace.value = { ...workspace.value };
  void mutate({ op: 'view', key: tab.key, view: 'file' });
}
