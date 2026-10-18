import { asButton } from '../dom.js';
/**
 * Navigation stack for tracking file/scroll position history.
 * Supports back/forward navigation like a browser.
 */

export interface NavEntry {
  /** Review file ID (null for raw repo files opened via go-to-definition) */
  fileId: string | null;
  /** File path (used for raw files) */
  filePath: string | null;
  /** First visible line number (updated on scroll) */
  scrollLine: number;
}

const histories = new Map<string, { stack: NavEntry[]; cursor: number }>();
function history() {
  const key = document.body.dataset.reviewId ?? '';
  let value = histories.get(key);
  if (!value) { value = { stack: [], cursor: -1 }; histories.set(key, value); }
  return value;
}
export function forgetNavigation(reviewId: string): void { histories.delete(reviewId); }
let navigating = false; // True when back/forward navigation is in progress

/** Push a new entry. Clears the forward stack unless we're navigating. */
export function navPush(entry: NavEntry) {
  if (navigating) return;
  // If the current entry is the same file, just update scroll position
  if (history().cursor >= 0 && isSameFile(history().stack[history().cursor], entry)) {
    history().stack[history().cursor].scrollLine = entry.scrollLine;
    updateButtons();
    return;
  }
  // Clear forward stack
  history().stack.length = history().cursor + 1;
  history().stack.push({ ...entry });
  history().cursor = history().stack.length - 1;
  updateButtons();
}

/** Update the scroll position of the current entry without pushing. */
export function navUpdateScroll(scrollLine: number) {
  if (history().cursor >= 0) {
    history().stack[history().cursor].scrollLine = scrollLine;
  }
}

/** Go back in the stack. Returns the entry to navigate to, or null. */
export function navBack(): NavEntry | null {
  if (history().cursor <= 0) return null;
  history().cursor--;
  updateButtons();
  return { ...history().stack[history().cursor] };
}

/** Go forward in the stack. Returns the entry to navigate to, or null. */
export function navForward(): NavEntry | null {
  if (history().cursor >= history().stack.length - 1) return null;
  history().cursor++;
  updateButtons();
  return { ...history().stack[history().cursor] };
}

export function canGoBack(): boolean { return history().cursor > 0; }
export function canGoForward(): boolean { return history().cursor < history().stack.length - 1; }

/** Set the navigating flag to prevent navPush during back/forward. */
export function setNavigating(v: boolean) { navigating = v; }

function isSameFile(a: NavEntry, b: NavEntry): boolean {
  if (a.fileId !== null || b.fileId !== null) {
    return a.fileId !== null && b.fileId !== null && a.fileId === b.fileId;
  }
  if (a.filePath !== null && b.filePath !== null) return a.filePath === b.filePath;
  return false;
}

/** Update the disabled state of the back/forward buttons. */
function updateButtons() {
  const backBtn = document.getElementById('nav-back-btn');
  const fwdBtn = document.getElementById('nav-forward-btn');
  if (backBtn) {
    backBtn.classList.toggle('disabled', !canGoBack());
    asButton(backBtn).disabled = !canGoBack();
  }
  if (fwdBtn) {
    fwdBtn.classList.toggle('disabled', !canGoForward());
    asButton(fwdBtn).disabled = !canGoForward();
  }
}

/** Get the first visible line number in the diff container. */
export function getVisibleScrollLine(): number {
  const container = document.getElementById('diff-container');
  if (!container) return 1;
  const rect = container.getBoundingClientRect();
  // Find the first .diff-line that's visible in the scroll container
  const lines = container.querySelectorAll<HTMLElement>('.diff-line[data-line]');
  for (const line of lines) {
    const lineRect = line.getBoundingClientRect();
    if (lineRect.top >= rect.top - 5) {
      return parseInt(line.dataset.line ?? '1', 10);
    }
  }
  return 1;
}
