import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindChangeNavigation } from '../../../src/client/diff/changeNavigation.js';

function fixture(positions = [100, 400, 700], maxScroll = 1000) {
  vi.useFakeTimers();
  let handler: (event: KeyboardEvent) => void;
  let scrollTop = 0;
  const blocks = positions.map((top, index) => ({
    dataset: { changeStart: String(index) },
    getBoundingClientRect: () => ({ top: top - scrollTop }),
    classList: { add: vi.fn(), remove: vi.fn() }, focus: vi.fn(), tabIndex: 0,
  }));
  let view = { querySelector: () => ({}), querySelectorAll: () => [...blocks].reverse() };
  const container = {
    querySelector: () => view,
    getBoundingClientRect: () => ({ top: 0 }),
    get scrollTop() { return scrollTop; },
    set scrollTop(n: number) { scrollTop = Math.max(0, Math.min(maxScroll, n)); },
  };
  const doc = {
    activeElement: { closest: vi.fn((): unknown => null) },
    getElementById: () => container,
    querySelectorAll: vi.fn((): unknown[] => []),
    addEventListener: (_type: string, callback: typeof handler) => { handler = callback; },
  };
  vi.stubGlobal('document', doc);
  bindChangeNavigation();
  return {
    blocks, doc, container,
    replaceView: () => { view = { ...view }; },
    key: (options: Partial<KeyboardEvent> = {}) => {
      const event = { key: 'Tab', preventDefault: vi.fn(), ...options };
      handler(event as KeyboardEvent);
      return event;
    },
  };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Tab change navigation', () => {
  it('uses logical block order across split columns and moves backward', () => {
    const f = fixture();
    expect(f.key().preventDefault).toHaveBeenCalledOnce();
    expect(f.blocks[0].focus).toHaveBeenCalledOnce();
    f.key(); expect(f.blocks[1].focus).toHaveBeenCalledOnce();
    f.key({ shiftKey: true }); expect(f.blocks[0].focus).toHaveBeenCalledTimes(2);
  });

  it('continues through blocks when scrolling is clamped, and stops at either end', () => {
    const f = fixture([100, 120, 140], 0);
    f.key(); f.key(); f.key(); f.key();
    expect(f.blocks.map(b => b.focus.mock.calls.length)).toEqual([1,1,2]);
    f.key({ shiftKey: true }); f.key({ shiftKey: true }); f.key({ shiftKey: true });
    expect(f.blocks.map(b => b.focus.mock.calls.length)).toEqual([3,2,2]);
  });

  it('reanchors to the viewport after manual scrolling', () => {
    const f = fixture();
    f.key();
    f.container.scrollTop = 500;
    f.key({ shiftKey: true });
    expect(f.blocks[1].focus).toHaveBeenCalledOnce();
  });

  it('resets navigation when a new file or diff mode mounts', () => {
    const f = fixture();
    f.key(); f.key();
    f.container.scrollTop = 0; f.replaceView(); f.key();
    expect(f.blocks[0].focus).toHaveBeenCalledTimes(2);
  });

  it.each([{ positions: [] }, { positions: [100] }])('handles zero or one changed block: %j', ({ positions }) => {
    const f = fixture(positions);
    expect(f.key().preventDefault).toHaveBeenCalledOnce();
    f.key(); f.key({ shiftKey: true });
    if (f.blocks.length) expect(f.blocks[0].focus).toHaveBeenCalledTimes(3);
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { defaultPrevented: true }, { key: 'Enter' }])('leaves other shortcuts alone: %j', options => {
    const f = fixture();
    expect(f.key(options).preventDefault).not.toHaveBeenCalled();
  });

  it('preserves normal Tab inside inputs, editable content, and visible dialogs', () => {
    const f = fixture();
    f.doc.activeElement.closest.mockReturnValue({});
    expect(f.key().preventDefault).not.toHaveBeenCalled();
    f.doc.activeElement.closest.mockReturnValue(null);
    f.doc.querySelectorAll.mockReturnValue([{ getClientRects: () => [{}] }]);
    expect(f.key().preventDefault).not.toHaveBeenCalled();
    f.doc.querySelectorAll.mockReturnValue([{ getClientRects: () => [] }]);
    expect(f.key().preventDefault).toHaveBeenCalledOnce();
  });
});
