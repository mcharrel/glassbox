/**
 * In-page find bar for diff content.
 * Triggered by Cmd/Ctrl+F. Searches visible text in the diff container,
 * highlights matches, and allows navigation between them.
 */
import { type SearchHit,searchReview } from '../../api/workspace.js';
import { IconChevronDown, IconChevronUp, IconX } from '../../icons.js';
import { toElement } from '../dom.js';
import { allFileOrder, reviewStore } from '../stores/index.js';
import { getTauriGlobal } from '../tauri.js';
import { activeTab, mutate, setFileView } from '../workspace/state.js';
import { bindReviewKeys } from './reviewKeys.js';
import { selectFile } from './selection.js';

/** The lazily-created find widget. All mutable widget state (elements, query,
 *  match cursor) lives inside the controller closure — not at module scope
 *  (GB-1087) — so the module carries no live UI state of its own. */
interface FindController {
  toggleFocus(): void;
  hide(): void;
  goToMatch(direction: number): void;
  isOpen(): boolean;
  search(query: string, line: number, side: string): void;
  refresh(): void;
}
let controller: FindController | null = null;

const HIGHLIGHT_CLASS = 'find-highlight';
const ACTIVE_HIGHLIGHT_CLASS = 'find-highlight-active';
const MATCH_INDEX_ATTR = 'data-match-index';

export function bindFind() {
  document.addEventListener('glassbox-review-selected', () => { controller?.hide(); });
  bindReviewKeys(direction => { controller?.goToMatch(direction); });
  // Use the same review search in desktop and browser windows.
  const nativeFind = getTauriGlobal()?.event;


  document.addEventListener('keydown', (e) => {
    // The desktop menu owns its accelerator; avoid toggling twice for one press.
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      if (nativeFind === undefined) (controller ??= createFindController()).toggleFocus();
      return;
    }
    if (controller === null || !controller.isOpen()) return;
    // Escape: close find bar
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      e.stopImmediatePropagation();
      controller.hide();
      return;
    }
    // Find next/previous — OS-standard shortcuts
    // macOS: Cmd+G / Shift+Cmd+G
    // Windows/Linux: F3 / Shift+F3
    if ((e.metaKey && e.key === 'g') || e.key === 'F3') {
      e.preventDefault();
      controller.goToMatch(e.shiftKey ? -1 : 1);
    }
  }, true);

  // Listen for Tauri menu event (Edit > Find)
  nativeFind?.listen('menu-find', () => {
    (controller ??= createFindController()).toggleFocus();
  });
}

/** Highlight a clicked symbol without taking focus or moving away from its definition. */
export function searchSymbol(query: string, line: number, side = 'new'): void {
  (controller ??= createFindController()).search(query, line, side);
}

/** Reapply the current query after a file or diff mode has finished mounting. */
export function refreshFind(): void {
  controller?.refresh();
}

function focusDiff(): void {
  const pane = document.getElementById('diff-container');
  if (!pane) return;
  pane.tabIndex = -1;
  pane.focus({ preventScroll: true });
}

/** Build the find-bar DOM once and return its controller. The bar is a
 *  Tauri-only, imperative widget outside every kerf mount tree, so direct
 *  listeners are stable here. */
function createFindController(): FindController {
  let currentQuery = '';
  let globalHits: SearchHit[] = [];
  let globalMatch = -1;
  let searchVersion = 0;
  let pendingHit: SearchHit | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let anchorLine = 0;
  let anchorSide = 'new';
  let matchCount = 0;
  let currentMatch = -1;

  const isMac = navigator.userAgent.includes('Mac');
  const findBar = toElement(
    <div className="find-bar">
      <input type="text" className="find-input" placeholder="Find across files and comments..." />
      <span className="find-match-count"></span>
      <button className="find-nav-btn" data-dir="prev"
        title={isMac ? 'Previous (\u21E7\u2318G)' : 'Previous (Shift+F3)'}><IconChevronUp /></button>
      <button className="find-nav-btn" data-dir="next"
        title={isMac ? 'Next (\u2318G)' : 'Next (F3)'}><IconChevronDown /></button>
      <button className="find-close-btn" title="Close (Esc)"><IconX /></button>
    </div>
  );

  const findInput = findBar.querySelector<HTMLInputElement>('.find-input');
  const matchLabel = findBar.querySelector<HTMLElement>('.find-match-count');

  function updateLabel(): void {
    if (matchLabel === null) return;
    if (currentQuery.length === 0) {
      matchLabel.textContent = '';
    } else if (matchCount === 0 && globalHits.length === 0) {
      matchLabel.textContent = 'No matches';
    } else {
      matchLabel.textContent = `${globalHits.length > 0 ? globalMatch + 1 : currentMatch + 1} of ${globalHits.length || matchCount}`;
    }
  }

  function runSearch(query: string, scroll = true): void {
    clearHighlights();
    matchCount = 0;
    currentMatch = -1;
    currentQuery = query;

    if (query.length === 0) {
      updateLabel();
      return;
    }

    const container = document.querySelector<HTMLElement>('.review-body');
    if (container === null) return;

    const { text, segments } = buildTextIndex(container);
    if (segments.length === 0) {
      updateLabel();
      return;
    }

    const spans = findMatchSpans(text, segments, query);

    // Wrap matches in reverse order so DOM mutation of later matches doesn't
    // shift earlier offsets (see wrapMatch).
    for (let m = spans.length - 1; m >= 0; m--) {
      wrapMatch(spans[m], segments, m);
    }

    matchCount = spans.length;
    if (matchCount > 0) {
      currentMatch = 0;
      if (!scroll && anchorLine > 0) {
        const match = container.querySelector<HTMLElement>(`.diff-line[data-side="${anchorSide}"][data-line="${String(anchorLine)}"] .${HIGHLIGHT_CLASS}`);
        currentMatch = Number(match?.dataset.matchIndex ?? 0);
      }
      activateMatch(currentMatch, scroll);
    }

    updateLabel();
  }

  function activateHit(hit: SearchHit, scroll = true): void {
    const selector = hit.annotationId !== undefined ? `[data-annotation-id="${hit.annotationId}"] .annotation-text`
      : hit.commentId !== undefined ? `[data-message="${hit.commentId}"] .pr-message-body`
      : `.diff-line[data-side="${hit.side}"][data-line="${hit.line}"] .code`;
    const cell = document.querySelector(selector);
    const marks = [...(cell?.querySelectorAll<HTMLElement>(`.${HIGHLIGHT_CLASS}`) ?? [])];
    const indices = [...new Set(marks.map(mark => Number(mark.dataset.matchIndex)))];
    if (hit.occurrence < indices.length) { activateMatch(indices[hit.occurrence], scroll); pendingHit = null; }
    else if (scroll) cell?.scrollIntoView({ block: 'center' });
  }
  function goToHit(hit: SearchHit): void {
    pendingHit = hit;
    if (hit.fileId === null) {
      const tab = activeTab();
      if (tab) void mutate({ op: 'view', key: tab.key, view: 'main' }).then(() => { runSearch(currentQuery, false); activateHit(hit); });
    } else {
      setFileView();
      const hidden = new Set(reviewStore.state.value.hiddenFileIds); hidden.delete(hit.fileId);
      reviewStore.actions.update({ hiddenFileIds: hidden });
      if (reviewStore.state.value.currentFileId !== hit.fileId) void selectFile(hit.fileId);
      else activateHit(hit);
    }
    updateLabel();
  }
  function requestGlobal(scroll: boolean): void {
    const version = ++searchVersion;
    clearTimeout(searchTimer);
    globalHits = []; globalMatch = -1; pendingHit = null;
    if (!currentQuery || document.body.dataset.reviewPending === 'true') return;
    const query = currentQuery;
    searchTimer = setTimeout(() => {
      void searchReview(query).then(hits => {
        if (version !== searchVersion || currentQuery !== query) return;
        const order = allFileOrder.value;
        globalHits = hits.sort((a, b) => {
          const ai = a.fileId === null ? order.length : order.indexOf(a.fileId);
          const bi = b.fileId === null ? order.length : order.indexOf(b.fileId);
          return ai - bi || a.line - b.line || a.side.localeCompare(b.side) || a.occurrence - b.occurrence;
        });
        globalMatch = globalHits.findIndex(hit => hit.fileId === reviewStore.state.value.currentFileId && (anchorLine === 0 || hit.line === anchorLine));
        if (globalMatch < 0 && globalHits.length > 0) globalMatch = 0;
        if (globalMatch >= 0) {
          if (scroll) goToHit(globalHits[globalMatch]);
          else activateHit(globalHits[globalMatch], false);
        }
        updateLabel();
      }).catch(() => { /* In-file find remains available while the index cannot be read. */ });
    }, 180);
  }
  function goToMatch(direction: number): void {
    if (globalHits.length > 0) {
      globalMatch = (globalMatch + direction + globalHits.length) % globalHits.length;
      goToHit(globalHits[globalMatch]); return;
    }
    if (matchCount === 0) return;
    currentMatch += direction;
    if (currentMatch >= matchCount) currentMatch = 0;
    if (currentMatch < 0) currentMatch = matchCount - 1;
    activateMatch(currentMatch);
    updateLabel();
  }

  function hide(): void {
    findBar.style.display = 'none';
    searchVersion++; clearTimeout(searchTimer); globalHits = []; globalMatch = -1; pendingHit = null;
    if (findInput) findInput.value = '';
    focusDiff();
    clearHighlights();
    currentQuery = '';
    anchorLine = 0;
    matchCount = 0;
    currentMatch = -1;
  }

  // `findInput` is a const — TS narrows it through the `?.` for the whole closure.
  findInput?.addEventListener('input', () => { anchorLine = 0; runSearch(findInput.value); requestGlobal(true); });
  findInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hide();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      goToMatch(e.shiftKey ? -1 : 1);
    }
  });
  findBar.querySelector('[data-dir="prev"]')?.addEventListener('click', () => { goToMatch(-1); });
  findBar.querySelector('[data-dir="next"]')?.addEventListener('click', () => { goToMatch(1); });
  findBar.querySelector('.find-close-btn')?.addEventListener('click', () => { hide(); });

  // Prevent clicks in the find bar from bubbling (e.g. triggering annotation creation)
  findBar.addEventListener('mousedown', (e) => { e.stopPropagation(); });

  const mainContent = document.querySelector('.main-content');
  if (mainContent) {
    mainContent.insertBefore(findBar, mainContent.firstChild);
  } else {
    document.body.appendChild(findBar);
  }

  return {
    toggleFocus(): void {
      if (document.activeElement === findInput) focusDiff();
      else {
        findBar.style.display = 'flex';
        findInput?.focus();
        findInput?.select();
      }
    },
    hide,
    search(query, line, side): void {
      anchorLine = line;
      anchorSide = side;
      findBar.style.display = 'flex';
      if (findInput) findInput.value = query;
      runSearch(query, false);
      requestGlobal(false);
      focusDiff();
    },
    refresh(): void {
      runSearch(currentQuery, false);
      if (pendingHit) activateHit(pendingHit);
      else if (globalMatch >= 0 && globalMatch < globalHits.length) activateHit(globalHits[globalMatch], false);
    },
    goToMatch,
    isOpen: () => findBar.style.display !== 'none',
  };
}

interface TextSegment {
  node: Text;
  start: number;  // global offset of this node's first char in the concatenated string
  length: number; // text length of this node
}

interface MatchSpan {
  startSeg: number; // index into segments[]
  startOff: number; // offset within segments[startSeg].node
  endSeg: number;
  endOff: number;
}

/** Pure segment shape — the DOM-agnostic subset of `TextSegment`. Exposed so
 *  the indexing math (which is where the cross-element bug lived) is
 *  unit-testable without a DOM environment. */
export interface SegmentInfo { start: number; length: number }

/**
 * Build a flat text index over every text node under `container`, in
 * document order. The concatenated string lets us run a single `indexOf`
 * across what is structurally many `<span>` siblings (syntax-highlighted
 * code), so a search like `raw(` matches even when "raw" lives in
 * `<span class="hljs-title">raw</span>` and `(` is a separate text node
 * right after it.
 */
function buildTextIndex(container: HTMLElement): { text: string; segments: TextSegment[] } {
  const segments: TextSegment[] = [];
  const parts: string[] = [];
  let pos = 0;
  // Search each code cell or comment independently; exclude surrounding chrome.
  for (const code of container.querySelectorAll('.code, .annotation-text, .pr-message-body')) {
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const content = node.data;
      if (content.length === 0) continue;
      segments.push({ node, start: pos, length: content.length });
      parts.push(content);
      pos += content.length;
    }
    parts.push('\n');
    pos++;
  }
  return { text: parts.join(''), segments };
}

/** Find the segment index whose character range covers `offset`. Searches
 *  forward from `hint` (matches advance monotonically through the text).
 *  Exported for unit tests. */
export function segmentForOffset(segments: SegmentInfo[], offset: number, hint: number): number {
  for (let i = hint; i < segments.length; i++) {
    const s = segments[i];
    if (offset >= s.start && offset < s.start + s.length) return i;
  }
  return segments.length - 1;
}

/** Compute every match span across a concatenated-text + segment layout.
 *  This is the pure piece of the find-across-elements fix — the DOM
 *  walker builds `text + segments`, this function says where every match
 *  lives, and the caller wraps the corresponding text-node ranges in
 *  `<mark>` tags. Exported for unit tests. */
export function findMatchSpans(text: string, segments: SegmentInfo[], query: string): MatchSpan[] {
  if (query === '' || segments.length === 0) return [];
  const lowerQuery = query.toLowerCase();
  const lowerText = text.toLowerCase();
  const spans: MatchSpan[] = [];
  let idx = 0;
  let hint = 0;
  while ((idx = lowerText.indexOf(lowerQuery, idx)) !== -1) {
    const endGlobal = idx + query.length;
    const startSeg = segmentForOffset(segments, idx, hint);
    const endSeg = segmentForOffset(segments, endGlobal - 1, startSeg);
    spans.push({
      startSeg,
      startOff: idx - segments[startSeg].start,
      endSeg,
      endOff: endGlobal - segments[endSeg].start,
    });
    hint = startSeg;
    idx = endGlobal;
  }
  return spans;
}

function wrapMatch(span: MatchSpan, segments: TextSegment[], matchIndex: number): void {
  for (let i = span.endSeg; i >= span.startSeg; i--) {
    const seg = segments[i];
    const lo = i === span.startSeg ? span.startOff : 0;
    const hi = i === span.endSeg ? span.endOff : seg.length;
    if (lo >= hi) continue;
    try {
      const sub = document.createRange();
      sub.setStart(seg.node, lo);
      sub.setEnd(seg.node, hi);
      const mark = toElement(<mark className={HIGHLIGHT_CLASS} {...{ [MATCH_INDEX_ATTR]: String(matchIndex) }}></mark>);
      sub.surroundContents(mark);
    } catch {
      // Skip a single segment's wrap; the rest of the match still renders.
      // surroundContents within a single text node should always succeed,
      // so this is a defensive no-op.
    }
  }
}

function clearHighlights() {
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach(mark => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize(); // merge adjacent text nodes
  });
}

function marksForMatch(index: number): NodeListOf<Element> {
  return document.querySelectorAll(`.${HIGHLIGHT_CLASS}[${MATCH_INDEX_ATTR}="${String(index)}"]`);
}

function activateMatch(index: number, scroll = true) {
  // Remove previous active class from every fragment of the prior match.
  document.querySelectorAll(`.${ACTIVE_HIGHLIGHT_CLASS}`).forEach(el => { el.classList.remove(ACTIVE_HIGHLIGHT_CLASS); });

  const marks = marksForMatch(index);
  if (marks.length === 0) return;
  // A single logical match may be split across multiple `<mark>` siblings
  // (one per text node it crosses). Mark all of them active so styling
  // applies to the whole highlight, and scroll the first into view.
  marks.forEach(el => { el.classList.add(ACTIVE_HIGHLIGHT_CLASS); });
  if (scroll) marks[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
}
