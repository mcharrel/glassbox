/**
 * Go-to-definition: Cmd+Click (macOS) / Ctrl+Click (Windows/Linux) on a symbol
 * in the diff view navigates to its definition.
 */
import { findSymbolDefinition } from '../../api/index.js';
import { asElement } from '../dom.js';
import { reviewStore } from '../stores/index.js';
import { JUMP_HIGHLIGHT_DURATION_MS } from '../timing.js';
import { showToast } from '../toast.js';
import { searchSymbol } from './find.js';
import { setRawDiffContent } from './index.js';
import { localDeclaration } from './localDeclaration.js';
import { navPush } from './navStack.js';
import { selectFile, updateNavFilePath } from './selection.js';
import { getWordAtPoint } from './wordAtPoint.js';


export function bindGoToDefinition() {
  const container = document.getElementById('diff-container');
  if (!container) return;

  container.addEventListener('click', (e) => {
    // Cmd+Click (macOS) or Ctrl+Click (Windows/Linux)
    if (!(e.metaKey || e.ctrlKey)) return;
    // Don't interfere with existing click handlers (annotations, buttons, etc.)
    if (asElement(e.target).closest('button, a, .annotation-row, .annotation-form-container')) return;

    const word = getWordAtPoint(e.clientX, e.clientY);
    if (word === null || word.length === 0) return;

    e.preventDefault();
    e.stopPropagation();
    const clicked = asElement(e.target).closest<HTMLElement>('.diff-line');
    if (!clicked) return;
    const side = clicked.dataset.side ?? 'new';
    const lines = [...container.querySelectorAll<HTMLElement>(`.diff-line[data-side="${side}"]`)]
      .map(row => ({ line: Number(row.dataset.line), content: row.querySelector('.code')?.textContent ?? '' }));
    const declaration = localDeclaration(lines, word, Number(clicked.dataset.line));
    if (declaration !== null) {
      searchSymbol(word, declaration, side);
      container.querySelector(`.diff-line[data-side="${side}"][data-line="${String(declaration)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else void navigateToDefinition(word);
  });

  // Show pointer cursor when Cmd/Ctrl is held over identifiers
  container.addEventListener('mousemove', (e) => {
    if (!(e.target instanceof Element)) return;
    const code = e.target.closest('.code');
    if (code instanceof HTMLElement) {
      code.style.cursor = (e.metaKey || e.ctrlKey) ? 'pointer' : '';
    }
  });
}

async function navigateToDefinition(symbolName: string) {
  const currentFileId = reviewStore.state.value.currentFileId ?? '';
  const data = await findSymbolDefinition({ name: symbolName, currentFileId });

  if (data.definitions.length === 0) {
    searchSymbol(symbolName, 0);
    showToast(`No definition found for "${symbolName}"`);
    return;
  }

  const def = data.definitions[0];
  searchSymbol(symbolName, def.line);
  await goToTarget(def.fileId, def.filePath, def.line, currentFileId);
}

/**
 * Navigate to a code location: scroll if it's the open file, switch files if
 * it's elsewhere in the review, else open it read-only.
 */
async function goToTarget(fileId: string | null, filePath: string, line: number, currentFileId: string) {
  if (fileId === null) {
    await loadRawFile(filePath, line);
    return;
  }
  if (fileId !== currentFileId) {
    await selectFile(fileId);
    // Selection starts an asynchronous fetch; wait for the requested diff to mount.
    const mounted = await new Promise<boolean>(resolve => {
      const pane = document.getElementById('diff-container');
      if (!pane) { resolve(false); return; }
      const finish = (found: boolean) => {
        observer.disconnect();
        clearTimeout(timer);
        resolve(found);
      };
      const check = () => {
        if (reviewStore.state.value.currentFileId !== fileId) {
          finish(false);
          return;
        }
        if (pane.querySelector<HTMLElement>('.diff-view')?.dataset.fileId === fileId) finish(true);
      };
      const observer = new MutationObserver(check);
      const timer = setTimeout(() => { finish(false); }, 10000);
      observer.observe(pane, { childList: true, subtree: true });
      check();
    });
    if (reviewStore.state.value.currentFileId !== fileId) return;
    if (!mounted) {
      showToast("Could not load the definition's file. Please try again.");
      return;
    }
  }
  // Unchanged definitions may be outside the rendered diff hunks.
  if (!scrollToLine(line)) await loadRawFile(filePath, line);
}

/**
 * Navigate to a repo-relative path + line, resolving the file against the
 * review's own file list. Backs the review-note embedded links (docs/20 §20.6),
 * which name a location by path rather than by symbol.
 */
export async function navigateToLocation(filePath: string, line: number) {
  const { currentFileId, files } = reviewStore.state.value;
  const match = files.find(f => f.file_path === filePath);
  await goToTarget(match?.id ?? null, filePath, line, currentFileId ?? '');
}

async function loadRawFile(filePath: string, targetLine: number) {
  const res = await fetch('/file-raw?path=' + encodeURIComponent(filePath) + '&reviewId=' + encodeURIComponent(document.body.dataset.reviewId ?? ''));
  if (!res.ok) {
    showToast(`Could not open ${filePath}`);
    return;
  }

  // Clear sidebar selection (this file isn't in the sidebar) and route the
  // raw HTML through the diff mount's signal — `setRawDiffContent()` handles
  // toolbar visibility + syntax highlighting via the post-render effect.
  document.querySelectorAll('.file-item.active').forEach(el => { el.classList.remove('active'); });
  reviewStore.actions.update({ currentFileId: null });
  setRawDiffContent(filePath, await res.text());

  updateNavFilePath(filePath);
  navPush({ fileId: null, filePath, scrollLine: targetLine });

  // Scroll to the target line (wait a frame for the mount + post-render to flush).
  requestAnimationFrame(() => { scrollToLine(targetLine); });
}

function scrollToLine(lineNumber: number) {
  // Find the diff line with this line number on the new side
  const lineEl = document.querySelector(
    `.diff-line[data-line="${lineNumber}"][data-side="new"]`
  );

  if (!lineEl) return false;
  lineEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
  // Brief highlight to show where we jumped to
  lineEl.classList.add('jump-highlight');
  setTimeout(() => { lineEl.classList.remove('jump-highlight'); }, JUMP_HIGHLIGHT_DURATION_MS);
  return true;
}
