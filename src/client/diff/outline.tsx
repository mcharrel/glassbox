import type { SafeHtml } from 'kerfjs';
import { delegate, effect, morph, signal } from 'kerfjs';

import { getOutline } from '../../api/index.js';
import { asEl, toElement } from '../dom.js';
import { dismissOnOutsideClick } from '../popup.js';
import { reviewStore } from '../stores/index.js';

interface OutlineSymbol {
  name: string;
  kind: 'class' | 'function';
  line: number;
  endLine: number;
  children: OutlineSymbol[];
}

// Per-container scroll handler, keyed in a WeakMap (same pattern as
// imageDiff/zoom.ts) instead of poking a mystery expando property on the node.
const scrollHandlers = new WeakMap<HTMLElement, () => void>();
const boundBars = new WeakSet<HTMLElement>();

// Reactive sources for the breadcrumb: the file's symbol tree and the
// currently top-most visible line. The effect() in `loadOutline()` reads both
// and re-runs `morph()` against the bar automatically — no manual
// `updateBreadcrumb()` calls.
const symbolsSignal = signal<OutlineSymbol[]>([]);
const topLineSignal = signal<number | null>(null);
let scrollRafId = 0;
const outlineCache = new Map<string, Promise<OutlineSymbol[]>>();
let outlineGeneration = 0;

export function invalidateOutlineCache(reviewId: string): void {
  for (const key of outlineCache.keys()) if (key.startsWith(reviewId + '|')) outlineCache.delete(key);
}

// Release the previous file's subscriptions before resetting the breadcrumb.
let disposeOutlineEffect: (() => void) | null = null;

export function clearOutline(): void {
  outlineGeneration++;
  if (disposeOutlineEffect !== null) {
    disposeOutlineEffect();
    disposeOutlineEffect = null;
  }
  symbolsSignal.value = [];
  topLineSignal.value = null;
  document.querySelectorAll('.outline-bar:not(.workspace-topbar), .outline-dropdown').forEach(el => { el.remove(); });
  const context = document.querySelector<HTMLElement>('.workspace-topbar .outline-context');
  if (context) morph(context, renderBreadcrumb([], null));
}

export async function loadOutline(fileId: string) {
  clearOutline();
  const generation = outlineGeneration;
  const reviewId = document.body.dataset.reviewId ?? '';

  try {
    const key = reviewId + '|' + fileId;
    let pending = outlineCache.get(key);
    if (!pending) {
      pending = getOutline({ fileId }).then(data => data.symbols).catch((error: unknown) => { outlineCache.delete(key); throw error; });
      outlineCache.set(key, pending);
    }
    const symbols = await pending;
    if (generation !== outlineGeneration || document.body.dataset.reviewId !== reviewId
      || reviewStore.state.value.currentFileId !== fileId || symbols.length === 0) return;
    symbolsSignal.value = symbols;
  } catch {
    return;
  }

  let bar = document.querySelector<HTMLElement>('.workspace-topbar');
  if (!bar) {
    const header = document.getElementById('diff-container')?.querySelector('.diff-header');
    if (!header) return;
    bar = toElement(<div className="outline-bar" id="outline-bar"></div>);
    header.after(bar);
  }
  // Reconcile only the breadcrumb so Settings survives file and PR switches.
  const context = bar.querySelector<HTMLElement>('.outline-context') ?? bar;
  disposeOutlineEffect = effect(() => {
    morph(context, renderBreadcrumb(symbolsSignal.value, topLineSignal.value));
  });

  if (!boundBars.has(bar)) {
    boundBars.add(bar);
    void delegate(bar, 'click', '.outline-breadcrumb', (e) => {
      e.stopPropagation();
      toggleDropdown();
    });
  }

  // Initial top-line snapshot + scroll tracker.
  topLineSignal.value = getTopVisibleLine();
  bindScrollTracking();
}

function findSymbolPath(symbols: OutlineSymbol[], line: number): OutlineSymbol[] {
  for (const s of symbols) {
    if (line >= s.line && line <= s.endLine) {
      const childPath = findSymbolPath(s.children, line);
      return [s, ...childPath];
    }
  }
  return [];
}

function getTopVisibleLine(): number | null {
  const container = document.getElementById('diff-container');
  if (container === null) return null;

  const lines = container.querySelectorAll('.diff-line[data-line]');
  const containerRect = container.getBoundingClientRect();
  const headerEl = container.querySelector<HTMLElement>('.diff-header');
  const headerHeight = headerEl?.offsetHeight ?? 0;
  const outlineBar = container.querySelector<HTMLElement>('.outline-bar');
  const outlineHeight = outlineBar?.offsetHeight ?? 0;
  const topOffset = containerRect.top + headerHeight + outlineHeight;

  for (const el of lines) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom > topOffset && rect.top < containerRect.bottom) {
      const lineNum = parseInt(asEl(el).dataset.line ?? '0', 10);
      if (lineNum > 0) return lineNum;
    }
  }
  return null;
}

function renderBreadcrumb(symbols: OutlineSymbol[], line: number | null): SafeHtml {
  const path = line !== null ? findSymbolPath(symbols, line) : [];
  return (
    <div className="outline-breadcrumb">
      <span className="outline-icon">&#9776;</span>
      {path.length > 0
        ? path.map((s, i) => (
            <span data-key={`crumb-${String(s.line)}`}>
              {i > 0 ? <span className="outline-separator">&rsaquo;</span> : null}
              <span className={`outline-crumb outline-kind-${s.kind}`}>{s.name}</span>
            </span>
          ))
        : <span className="outline-crumb outline-crumb-empty">Top level</span>}
    </div>
  );
}

function toggleDropdown() {
  const existing = document.querySelector('.outline-dropdown');
  if (existing !== null) {
    existing.remove();
    return;
  }
  showDropdown();
}

function showDropdown() {
  document.querySelectorAll('.outline-dropdown').forEach(el => { el.remove(); });

  const bar = document.getElementById('outline-bar');
  const symbols = symbolsSignal.value;
  if (bar === null || symbols.length === 0) return;

  const dropdown = toElement(
    <div className="outline-dropdown">
      {renderSymbolList(symbols, 0)}
    </div>
  );

  // Dropdown sits outside the breadcrumb mount tree (appended to `bar` after
  // the mount-managed children), so a single delegated listener on the
  // dropdown root is stable. Item clicks navigate + close.
  void delegate(dropdown, 'click', '.outline-item', (_e, el) => {
    const line = parseInt(asEl(el).dataset.line ?? '0', 10);
    if (line > 0) {
      scrollToLine(line);
      dropdown.remove();
    }
  });

  bar.appendChild(dropdown);

  dismissOnOutsideClick(dropdown, undefined, () => [bar.querySelector('.outline-breadcrumb')]);
}

function renderSymbolList(symbols: OutlineSymbol[], depth: number): SafeHtml {
  return (
    <div>
      {symbols.map(s => (
        <div data-key={`sym-${String(s.line)}`}>
          <div className={`outline-item outline-kind-${s.kind}`} data-line={String(s.line)} style={`padding-left: ${String(12 + depth * 16)}px`}>
            <span className="outline-item-icon">{s.kind === 'class' ? 'C' : 'f'}</span>
            {s.name}
            <span className="outline-item-line">:{s.line}</span>
          </div>
          {s.children.length > 0 ? renderSymbolList(s.children, depth + 1) : null}
        </div>
      ))}
    </div>
  );
}

function scrollToLine(lineNum: number) {
  const container = document.getElementById('diff-container');
  if (container === null) return;

  const target =
    container.querySelector(`.diff-line[data-line="${String(lineNum)}"][data-side="new"]`) ??
    container.querySelector(`.diff-line[data-line="${String(lineNum)}"]`);
  if (target === null) return;

  const headerEl = container.querySelector<HTMLElement>('.diff-header');
  const headerHeight = headerEl?.offsetHeight ?? 0;
  const outlineBar = container.querySelector<HTMLElement>('.outline-bar');
  const outlineHeight = outlineBar?.offsetHeight ?? 0;

  const targetRect = target.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const offset = targetRect.top - containerRect.top + container.scrollTop - headerHeight - outlineHeight;

  container.scrollTo({ top: offset, behavior: 'smooth' });
}

function bindScrollTracking() {
  const container = document.getElementById('diff-container');
  if (container === null) return;

  const prev = scrollHandlers.get(container);
  if (prev !== undefined) container.removeEventListener('scroll', prev);

  const handler = () => {
    if (scrollRafId !== 0) return;
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = 0;
      topLineSignal.value = getTopVisibleLine();
    });
  };

  scrollHandlers.set(container, handler);
  container.addEventListener('scroll', handler, { passive: true });
}
