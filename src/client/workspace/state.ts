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
export function activeTab(): PullTab | undefined {
  return workspace.value.tabs.find((t) => t.key === workspace.value.active);
}
export async function refreshWorkspace(): Promise<void> {
  const state = await getWorkspace();
  // Keep editors intact while background synchronization continues on the server.
  if (
    document.querySelector(
      '.pr-tab.dragging, .pr-title-input, .pr-message-editor, .request-changes-form, .pr-description-editor',
    ) !== null ||
    [...document.querySelectorAll('textarea')].some((input) => input.value.length > 0 && !input.disabled)
  )
    return;
  workspace.value = state;
}
export async function mutate(input: WorkspaceMutation): Promise<boolean> {
  try {
    workspace.value = await changeWorkspace(input);
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
