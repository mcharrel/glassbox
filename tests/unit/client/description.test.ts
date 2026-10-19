import { afterEach, describe, expect, it, vi } from 'vitest';
import { clickedDescriptionText } from '../../../src/client/workspace/description.js';

function fixture() {
  class Element { closest = vi.fn(() => null); }
  const target = new Element();
  const node = { nodeType: 3, textContent: 'A description wrapped onto two lines' };
  const body = { contains: vi.fn(value => value === node || value === target) };
  const range = {
    selectNodeContents: vi.fn(),
    getClientRects: () => [
      { left: 20, right: 180, top: 10, bottom: 30, width: 160, height: 20 },
      { left: 20, right: 80, top: 40, bottom: 60, width: 60, height: 20 },
    ],
  };
  const doc = {
    caretPositionFromPoint: vi.fn(() => ({ offsetNode: node })),
    caretRangeFromPoint: vi.fn(() => ({ startContainer: node })),
    getSelection: vi.fn(() => ({ isCollapsed: true })),
    createRange: () => range,
  };
  vi.stubGlobal('Element', Element);
  vi.stubGlobal('Node', { TEXT_NODE: 3 });
  vi.stubGlobal('document', doc);
  return {
    doc, target, node, body,
    click: (options: Partial<MouseEvent> = {}) => clickedDescriptionText(
      { target, button: 0, clientX: 30, clientY: 20, ...options } as unknown as MouseEvent,
      body as unknown as HTMLElement,
    ),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('description text clicks', () => {
  it('accepts text on either rendered line, including the desktop WebKit fallback', () => {
    const f = fixture();
    expect(f.click()).toBe(true);
    expect(f.click({ clientY: 50 })).toBe(true);
    f.doc.caretPositionFromPoint = undefined as any;
    expect(f.click()).toBe(true);
  });
  it.each([
    { clientX: 5 }, { clientX: 200 }, { clientY: 5 }, { clientY: 35 },
    { clientX: 100, clientY: 50 }, { clientY: 100 },
  ])('ignores surrounding whitespace even when the caret snaps to text: %j', point => {
    expect(fixture().click(point)).toBe(false);
  });
  it('ignores selections, interactive content, non-text nodes, and text outside the description', () => {
    const f = fixture();
    f.doc.getSelection.mockReturnValue({ isCollapsed: false });
    expect(f.click()).toBe(false);
    f.doc.getSelection.mockReturnValue({ isCollapsed: true });
    f.target.closest.mockReturnValue({} as any);
    expect(f.click()).toBe(false);
    f.target.closest.mockReturnValue(null);
    f.node.nodeType = 1;
    expect(f.click()).toBe(false);
    f.node.nodeType = 3;
    f.node.textContent = ' \n ';
    expect(f.click()).toBe(false);
    f.node.textContent = 'Elsewhere';
    f.body.contains.mockReturnValue(false);
    expect(f.click()).toBe(false);
  });
  it.each([{ button: 1 }, { metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }, { defaultPrevented: true }])('ignores modified clicks: %j', options => {
    expect(fixture().click(options)).toBe(false);
  });
  it('does not edit when no text caret can be resolved', () => {
    const f = fixture();
    f.doc.caretPositionFromPoint.mockReturnValue(null as any);
    f.doc.caretRangeFromPoint.mockReturnValue(null as any);
    expect(f.click()).toBe(false);
  });
});
