import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deleteHoveredComment, initCommentDelete } from '../../../src/client/workspace/commentDelete.js';

class FakeElement {
  isConnected = true;
  parent: FakeElement | null = null;
  kind = '';
  button: { disabled: boolean; click: ReturnType<typeof vi.fn> } | null = null;
  closest(selector: string): FakeElement | null {
    if (selector === '.pr-message, .annotation-item' && ['message', 'annotation'].includes(this.kind)) return this;
    if (selector.includes('textarea') && this.kind === 'input') return this;
    return this.parent?.closest(selector) ?? null;
  }
  querySelector() { return this.button; }
}
let doc: EventTarget & { querySelector: ReturnType<typeof vi.fn>; elementFromPoint: ReturnType<typeof vi.fn> };
let win: EventTarget;
beforeEach(() => {
  doc = Object.assign(new EventTarget(), { querySelector: vi.fn().mockReturnValue(null), elementFromPoint: vi.fn() });
  win = new EventTarget();
  vi.stubGlobal('document', doc); vi.stubGlobal('window', win); vi.stubGlobal('Element', FakeElement);
});
afterEach(() => vi.unstubAllGlobals());
function comment(kind = 'message') {
  const root = new FakeElement(); root.kind = kind; root.button = { disabled: false, click: vi.fn() };
  const body = new FakeElement(); body.parent = root;
  return { root, body, button: root.button };
}
function key(fields = {}) {
  return Object.defineProperties(new Event('keydown', { cancelable: true }),
    Object.fromEntries(Object.entries({ key: 'd', ...fields }).map(([name, value]) => [name, { value }]))) as KeyboardEvent;
}
it.each(['message', 'annotation'])('deletes the hovered %s using its existing action', kind => {
  const { body, button } = comment(kind); const event = key();
  expect(deleteHoveredComment(event, body as unknown as Element)).toBe(true);
  expect(button.click).toHaveBeenCalledOnce(); expect(event.defaultPrevented).toBe(true);
});
it('deletes the hovered reply, not its parent thread', () => {
  const parent = comment(); const reply = comment(); reply.root.parent = parent.root;
  deleteHoveredComment(key(), reply.body as unknown as Element);
  expect(reply.button.click).toHaveBeenCalledOnce(); expect(parent.button.click).not.toHaveBeenCalled();
});
it.each([{ key: 'D' }, { key: 'x' }, { repeat: true }, { isComposing: true }, { metaKey: true },
  { ctrlKey: true }, { altKey: true }, { shiftKey: true }])('ignores modified or unrelated keys %j', fields => {
  const { body, button } = comment();
  expect(deleteHoveredComment(key(fields), body as unknown as Element)).toBe(false);
  expect(button.click).not.toHaveBeenCalled();
});
it('respects typing, dialogs, consumed events, disabled actions and non-deletable comments', () => {
  const { root, body, button } = comment();
  const input = new FakeElement(); input.kind = 'input';
  expect(deleteHoveredComment(key({ target: input }), body as unknown as Element)).toBe(false);
  doc.querySelector.mockReturnValue({});
  expect(deleteHoveredComment(key(), body as unknown as Element)).toBe(false);
  doc.querySelector.mockReturnValue(null);
  const consumed = key(); consumed.preventDefault();
  expect(deleteHoveredComment(consumed, body as unknown as Element)).toBe(false);
  button.disabled = true;
  expect(deleteHoveredComment(key(), body as unknown as Element)).toBe(false);
  button.disabled = false; root.isConnected = false;
  expect(deleteHoveredComment(key(), body as unknown as Element)).toBe(false);
  root.isConnected = true; root.button = null;
  expect(deleteHoveredComment(key(), body as unknown as Element)).toBe(false);
  expect(deleteHoveredComment(key(), null)).toBe(false);
  expect(deleteHoveredComment(key(), new FakeElement() as unknown as Element)).toBe(false);
  expect(button.click).not.toHaveBeenCalled();
});
it('hit-tests fresh content at the pointer and forgets it when leaving the window', () => {
  initCommentDelete();
  const first = comment(); const next = comment();
  doc.elementFromPoint.mockReturnValue(first.body);
  doc.dispatchEvent(key()); expect(first.button.click).not.toHaveBeenCalled();
  const move = () => doc.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 30, clientY: 50 }));
  move();
  doc.elementFromPoint.mockReturnValue(next.body); // A refresh replaced the comment after pointer movement.
  doc.dispatchEvent(key());
  expect(doc.elementFromPoint).toHaveBeenCalledWith(30, 50);
  expect(next.button.click).toHaveBeenCalledOnce(); expect(first.button.click).not.toHaveBeenCalled();
  win.dispatchEvent(new Event('blur')); doc.dispatchEvent(key());
  move(); doc.dispatchEvent(new Event('pointerleave')); doc.dispatchEvent(key());
  expect(next.button.click).toHaveBeenCalledOnce();
});
