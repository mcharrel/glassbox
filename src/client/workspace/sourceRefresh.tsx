import { delegate, effect, mount } from 'kerfjs';

import { type PullTab, reportVisibility } from '../../api/workspace.js';
import { invalidateDiffCache } from '../diff/index.js';
import { loadFiles } from '../sidebar/fileTree.js';
import { activeReviewReady, activeTab, addingPull, mutate, refreshingPulls, reviewRetry } from './state.js';

export function codeFocusTab(tab: PullTab | undefined, visible: boolean, adding: boolean): string | null {
  return visible && !adding && tab?.view === 'file' ? tab.key : null;
}
export function sourceRefreshButton(tab?: PullTab) {
  return tab?.view === 'file' && tab.sourceRefreshRequested !== undefined && tab.info !== null
    && tab.reviewedHead !== tab.info.headRefOid
    ? <button className="source-refresh" data-workspace="refresh" disabled={tab.loading || refreshingPulls.value.has(tab.key)}>Refresh</button> : null;
}

export function initSourceRefresh(): void {
  const slot = document.getElementById('source-refresh-slot');
  if (slot) mount(slot, () => addingPull.value ? null : sourceRefreshButton(activeTab()));
  const id = crypto.randomUUID();
  let previous = '';
  const report = (force = false) => {
    const visible = document.visibilityState === 'visible' && document.hasFocus();
    const codeTab = codeFocusTab(activeTab(), visible, addingPull.value);
    // Preserve unfinished code comments even when the window loses focus.
    const draftTab = [...document.querySelectorAll<HTMLTextAreaElement>('.annotation-form textarea, .pr-reply-input')]
      .some(input => input.value.trim().length > 0 && !input.disabled) ? activeTab()?.key ?? null : null;
    const key = JSON.stringify([visible, codeTab, draftTab]);
    if (!force && key === previous) return;
    previous = key;
    void reportVisibility({ id, visible, codeTab, draftTab }).catch(() => { previous = ''; });
  };
  effect(() => { report(); });
  void delegate(document.body, 'input', '.annotation-form textarea, .pr-reply-input', () => { report(); });
  document.addEventListener('visibilitychange', () => { report(); });
  window.addEventListener('focus', () => { report(); });
  window.addEventListener('blur', () => { report(); });
  setInterval(() => { report(true); }, 10000);
}

/** The button and Cmd/Ctrl+R share the same explicit refresh path. */
export async function refreshActivePull(): Promise<void> {
  const tab = activeTab();
  if (!tab || tab.loading || refreshingPulls.value.has(tab.key)) return;
  // Keep local progress independent of snapshots received while the request is pending.
  refreshingPulls.value = new Set([...refreshingPulls.value, tab.key]);
  try {
    const ok = await mutate({ op: 'refresh', key: tab.key });
    if (!ok || activeTab()?.key !== tab.key) return;
    if (activeReviewReady()) await loadFiles();
    if (activeTab()?.key === tab.key) {
      reviewRetry.value++;
      if (activeReviewReady()) invalidateDiffCache();
    }
  } finally {
    refreshingPulls.value = new Set([...refreshingPulls.value].filter(key => key !== tab.key));
  }
}
