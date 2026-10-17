import { delegate, effect, mount } from 'kerfjs';
import { delegateActions } from 'kerfjs/actions';
import { debounce } from 'kerfjs/timing';

import { RiskDimensionSchema, saveAIPreferences } from '../../api/index.js';
import { navigateToLocation } from '../diff/goToDefinition.js';
import { selectFile } from '../diff/selection.js';
import { asEl, asElement, asInput, asSelect, toElement } from '../dom.js';
import type { SortMode } from '../state.js';
import { aiStore, diffViewStore, folderModeFiles, reviewStore, visibleFileOrder, visibleNoteLines } from '../stores/index.js';
import { FILTER_DEBOUNCE_MS } from '../timing.js';
import { bindDivider } from '../workspace/resize.js';
import { setFileView } from '../workspace/state.js';
import { ACTIONS } from './actions.js';
import { sidebarNotesJsx } from './aiNotes.js';
import { bindFileContextMenu } from './contextMenu.js';
import { fileListJsx } from './fileListView.js';
import { noteStorageFolderKeys } from './folderTree.js';
import { bindNotesResize } from './notesResize.js';
import { bindNoteVisibility } from './noteVisibility.js';
import { showRiskPopover } from './riskPopover.js';
import { sortControlJsx } from './sortControl.js';
import { switchSortMode } from './sortMode.js';


export function initSidebar(): void {
  const sidebar = document.querySelector<HTMLElement>('.sidebar');
  if (sidebar === null) return;

  restoreCollapsedFolders();
  mountSortControl(sidebar);
  mountFileList(sidebar);
  const notes = sidebar.querySelector<HTMLElement>('#sidebar-ai-notes');
  if (notes) {
    mount(notes, () => sidebarNotesJsx());
    bindNotesResize(sidebar, notes);
    effect(() => { void visibleNoteLines.value; notes.scrollTop = 0; });
    const diff = document.getElementById('diff-container');
    if (diff) bindNoteVisibility(diff);
  }
  bindDelegatedEvents(sidebar);
  bindFileContextMenu(sidebar);
  bindSidebarResize();
  bindSidebarToggle();
  bindKeyboardNav();
  bindAutoScroll(sidebar);
}

/** Hide/show the sidebar from the nav-bar toggle (GB-955). Intentionally not
 *  persisted across reloads: the toggle lives in the nav bar (shown once a file
 *  is open), so persisting a collapsed state could otherwise strand the user
 *  with no sidebar and no visible toggle on a fresh load. */
function bindSidebarToggle(): void {
  const btn = document.getElementById('sidebar-toggle-btn');
  const app = document.querySelector<HTMLElement>('.review-app');
  if (btn === null || app === null) return;
  btn.addEventListener('click', () => {
    const collapsed = app.classList.toggle('sidebar-collapsed');
    btn.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
    btn.setAttribute('title', collapsed ? 'Show sidebar' : 'Hide sidebar');
  });
}

function mountSortControl(sidebar: HTMLElement): void {
  const filterEl = sidebar.querySelector('.file-filter');
  if (filterEl === null) return;
  const container = toElement(<div className="sort-mode-container"></div>);
  filterEl.after(container);
  mount(container, () => sortControlJsx());
}

function mountFileList(sidebar: HTMLElement): void {
  const listEl = sidebar.querySelector<HTMLElement>('.file-list-items');
  if (listEl === null) return;
  mount(listEl, () => fileListJsx());
}

function bindDelegatedEvents(sidebar: HTMLElement): void {
  void delegate(sidebar, 'click', '[data-note-path]', (_event, button) => {
    const { notePath, noteLine } = asEl(button).dataset;
    const line = Number(noteLine);
    if (notePath !== undefined && notePath !== '' && Number.isInteger(line) && line > 0) void navigateToLocation(notePath, line);
  });
  void delegate(sidebar, 'click', '[data-sort-mode]', (_e, btn) => {
    const mode = asEl(btn).dataset.sortMode as SortMode;
    if (mode === aiStore.state.value.sortMode) return;
    if ((mode === 'risk' || mode === 'narrative') && !aiStore.state.value.aiConfigured) {
      void import('../settings/dialog.js').then(m => {
        m.showSettingsDialog(() => { switchSortMode(mode); });
      });
      return;
    }
    switchSortMode(mode);
  });

  void delegate(sidebar, 'change', ACTIONS.setRiskDimension.selector, (_e, sel) => {
    const value = asSelect(sel).value;
    aiStore.actions.update({ riskSortDimension: value });
    const riskDimParsed = RiskDimensionSchema.safeParse(value);
    if (riskDimParsed.success) {
      void saveAIPreferences({ risk_sort_dimension: riskDimParsed.data });
    }
  });

  // Trailing-edge debounce (kerfjs/timing) — replaces the hand-rolled
  // filterTimer + clearTimeout dance.
  const applyFilter = debounce((value: string) => {
    reviewStore.actions.update({ filterText: value });
  }, FILTER_DEBOUNCE_MS);
  void delegate(sidebar, 'input', '#file-filter', (_e, input) => {
    applyFilter(asInput(input).value);
  });
  void delegate(sidebar, 'keydown', '#file-filter', (e, input) => {
    if ((e as KeyboardEvent).key === 'Escape') {
      const el = asInput(input);
      el.value = '';
      applyFilter.cancel(); // drop a pending debounced update so it can't clobber the clear
      reviewStore.actions.update({ filterText: '' });
      el.blur();
    }
  });

  // The whole `data-action` click table dispatched by one delegated listener
  // (kerfjs/actions `delegateActions`) — replaces six separate delegate() calls.
  // Nearest-action-wins is exactly what the nesting needs: a click on the risk
  // badge (`show-risk-popover`, a child of a `select-file` row) resolves to the
  // badge's own action, so it opens the popover without also selecting the file
  // (what the previous code's `e.stopPropagation()` was reaching for).
  void delegateActions(sidebar, 'click', {
    [ACTIONS.toggleRiskScores.value]: () => {
      const next = !aiStore.state.value.showRiskScores;
      aiStore.actions.update({ showRiskScores: next });
      void saveAIPreferences({ show_risk_scores: next });
    },
    [ACTIONS.selectFile.value]: (_e, el) => {
      const fileId = asEl(el).dataset.fileId;
      if (fileId !== undefined && fileId !== '') { setFileView(); void selectFile(fileId); }
    },
    [ACTIONS.toggleFolder.value]: (_e, header) => {
      const path = asEl(header).dataset.folderPath ?? '';
      if (path === '') return;
      if (diffViewStore.state.value.collapsedFolders.has(path)) {
        diffViewStore.actions.removeCollapsedFolder(path);
      } else {
        diffViewStore.actions.addCollapsedFolder(path);
      }
      saveCollapsedFolders();
    },
    [ACTIONS.showRiskPopover.value]: (_e, badge) => {
      const fileId = asEl(badge).dataset.fileId ?? '';
      const score = (aiStore.state.value.riskScores ?? []).find(s => s.reviewFileId === fileId);
      if (score !== undefined) showRiskPopover(asEl(badge), score);
    },
    [ACTIONS.retryAnalysis.value]: (_e, btn) => {
      const mode = asEl(btn).dataset.mode as 'risk' | 'narrative';
      void import('./sortMode.js').then(m => { m.triggerAnalysis(mode); });
    },
    [ACTIONS.toggleHideIdentical.value]: () => {
      diffViewStore.actions.update({ hideIdentical: !diffViewStore.state.value.hideIdentical });
    },
  });
}

function bindSidebarResize(): void {
  const handle = document.querySelector<HTMLElement>('.sidebar-resize');
  const sidebar = document.querySelector<HTMLElement>('.sidebar');
  if (handle && sidebar) bindDivider(handle, sidebar, 'width', 'glassbox.sidebarWidth', 200, sidebar.offsetWidth || 300);
}

function bindKeyboardNav(): void {
  void delegate(document.body, 'keydown', 'body', (e) => {
    const ke = e as KeyboardEvent;
    const tag = asElement(ke.target).tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') return;
    if (ke.key === 'j' || ke.key === 'ArrowDown') {
      navigateFile(1);
      ke.preventDefault();
    } else if (ke.key === 'k' || ke.key === 'ArrowUp') {
      navigateFile(-1);
      ke.preventDefault();
    }
  });
}

function navigateFile(delta: number): void {
  const order = visibleFileOrder.value;
  const currentFileId = reviewStore.state.value.currentFileId;
  const idx = currentFileId !== null ? order.indexOf(currentFileId) : -1;
  const next = idx + delta;
  if (next >= 0 && next < order.length) {
    void selectFile(order[next]);
  }
}

function bindAutoScroll(sidebar: HTMLElement): void {
  let last: string | null = null;
  effect(() => {
    const fileId = reviewStore.state.value.currentFileId;
    if (fileId === null || fileId === last) return;
    last = fileId;
    requestAnimationFrame(() => {
      const active = sidebar.querySelector<HTMLElement>(`.file-item[data-file-id="${fileId}"]`);
      active?.scrollIntoView({ block: 'nearest' });
    });
  });
}

function storageKey(): string {
  return 'glassbox-collapsed-' + reviewStore.state.value.reviewId;
}

function saveCollapsedFolders(): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify([...diffViewStore.state.value.collapsedFolders]));
  } catch { /* localStorage unavailable */ }
}

function restoreCollapsedFolders(): void {
  try {
    const stored = localStorage.getItem(storageKey());
    if (stored === null) {
      // First visit to this review: collapse the `.pr-notes` note-storage
      // folders by default (GB-1135) so the committed SARIF files don't clutter
      // the tree. Persist immediately so a later manual expand sticks instead of
      // being re-seeded on the next load.
      const defaults = noteStorageFolderKeys(folderModeFiles());
      if (defaults.length > 0) {
        diffViewStore.actions.update({ collapsedFolders: new Set(defaults) });
        saveCollapsedFolders();
      }
      return;
    }
    const parsed: unknown = JSON.parse(stored);
    // Validate the shape rather than trusting it — keep only the strings.
    if (!Array.isArray(parsed)) return;
    const folders = parsed.filter((x): x is string => typeof x === 'string');
    diffViewStore.actions.update({ collapsedFolders: new Set(folders) });
  } catch { /* localStorage unavailable or malformed JSON */ }
}
