import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ mirror: null as any, template: '' }));
vi.mock('../../../src/client/dom.js', () => ({ toElement: (value: unknown) => { mocks.template = String(value); return mocks.mirror; } }));
import { descriptionEditOffset, focusDescriptionEditor, resizeDescriptionEditor } from '../../../src/client/workspace/descriptionEditor.js';

class Element {
  nodeType = 1;
  constructor(public tagName: string, public childNodes: any[] = []) {}
}
const text = (textContent: string) => ({ nodeType: 3, textContent, childNodes: [] });
let frames: FrameRequestCallback[];
beforeEach(() => {
  frames = [];
  vi.stubGlobal('Element', Element); vi.stubGlobal('Node', { TEXT_NODE: 3 });
  vi.stubGlobal('getComputedStyle', () => ({ fontFamily: 'system-ui', fontSize: '16px', lineHeight: '25.6px' }));
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.push(fn); });
});
afterEach(() => vi.unstubAllGlobals());
it('maps minified block markup and line breaks while preserving inline formatting and normalized newlines', () => {
  const hit = text('target');
  const body = new Element('DIV', [new Element('P', [text('Heading')]), new Element('P', [text('Next '), new Element('STRONG', [hit])])]);
  const source = 'Heading\r\n\r\nNext **target**';
  expect(descriptionEditOffset(source, body as any, { node: hit as any, offset: 3, top: 80 })).toBe(source.replaceAll('\r', '').indexOf('target') + 3);
  const suffix = text('view');
  expect(descriptionEditOffset('re**view**', new Element('P', [text('re'), new Element('STRONG', [suffix])]) as any,
    { node: suffix as any, offset: 2, top: 80 })).toBe(6);
  const next = text('target');
  expect(descriptionEditOffset('first\ntarget', new Element('P', [text('first'), new Element('BR'), next]) as any,
    { node: next as any, offset: 2, top: 80 })).toBe(8);
});
function editor() {
  const container = { scrollTop: 120 };
  const textarea = { style: {} as Record<string, string>, value: 'First line\nnext word', clientWidth: 720, scrollHeight: 500,
    closest: () => container, focus: vi.fn(), selectionStart: 0, selectionEnd: 0, isConnected: true,
    setSelectionRange(start: number, end: number) { this.selectionStart = start; this.selectionEnd = end; },
    getBoundingClientRect: () => ({ top: 100 }),
  };
  const doc = { body: { append: vi.fn() }, activeElement: textarea };
  mocks.mirror = { style: {}, querySelector: () => ({ getClientRects: () => [{ top: 42 }] }), getBoundingClientRect: () => ({ top: 0 }), remove: vi.fn() };
  vi.stubGlobal('document', doc);
  return { container, textarea, doc };
}
it('matches the measured wrapping, places the caret and preserves its viewport line without changing text', () => {
  const { container, textarea } = editor();
  focusDescriptionEditor(textarea as any, container as any, 15, 60, 120);
  expect(textarea.focus).toHaveBeenCalledWith({ preventScroll: true });
  expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([15, 15]);
  expect(container.scrollTop).toBe(202);
  expect(textarea.style.height).toBe('500px'); expect(textarea.value).toBe('First line\nnext word');
  expect(mocks.mirror.style).toMatchObject({ width: '720px', fontSize: '16px', lineHeight: '25.6px' });
  expect(mocks.mirror.remove).toHaveBeenCalledOnce();
  container.scrollTop = 0; frames[0](0); expect(container.scrollTop).toBe(202);
});
it('does not override typing, a changed selection or navigation in the delayed WebKit correction', () => {
  const { container, textarea, doc } = editor();
  focusDescriptionEditor(textarea as any, container as any, 15, 60, 120);
  container.scrollTop = 25; textarea.selectionStart = 16; frames[0](0); expect(container.scrollTop).toBe(25);
  textarea.selectionStart = 15; doc.activeElement = {} as any; frames[0](0); expect(container.scrollTop).toBe(25);
  doc.activeElement = textarea; textarea.isConnected = false; frames[0](0); expect(container.scrollTop).toBe(25);
});
it('resizes long drafts without resetting the container scroll position', () => {
  const { container, textarea } = editor();
  resizeDescriptionEditor(textarea as any);
  expect(textarea.style.height).toBe('500px'); expect(container.scrollTop).toBe(120);
  textarea.scrollHeight = 900; resizeDescriptionEditor(textarea as any);
  expect(textarea.style.height).toBe('900px'); expect(container.scrollTop).toBe(120);
});
