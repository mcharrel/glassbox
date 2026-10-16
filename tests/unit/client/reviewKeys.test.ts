import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindReviewKeys } from '../../../src/client/diff/reviewKeys.js';
let handler: (e: KeyboardEvent) => void;
let now = 1000;
let modal = false;
const scrollTo = vi.fn();
const next = vi.fn();
class Target {
  constructor(private editable = false) {}
  closest() { return this.editable ? this : null; }
}
const key = (key: string, props = {}) => {
  const event = { key, target: new Target(), preventDefault: vi.fn(), ...props };
  handler(event as unknown as KeyboardEvent);
  return event;
};
beforeEach(() => {
  now = 1000; modal = false; scrollTo.mockClear(); next.mockClear();
  vi.stubGlobal('Element', Target);
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('document', {
    addEventListener: (_name: string, fn: typeof handler) => { handler = fn; },
    getElementById: () => ({ scrollTo }),
    querySelector: () => modal ? {} : null,
  });
  bindReviewKeys(next);
});
afterEach(() => vi.unstubAllGlobals());
it('gg scrolls to the absolute file top but single, delayed and held g do not', () => {
  key('g'); expect(scrollTo).not.toHaveBeenCalled();
  now += 100; key('g'); expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });
  scrollTo.mockClear(); key('g'); now += 800; key('g'); expect(scrollTo).not.toHaveBeenCalled();
  key('g', { repeat: true }); expect(scrollTo).not.toHaveBeenCalled();
});
it('n and N navigate forward/backward', () => {
  key('n'); key('N', { shiftKey: true });
  expect(next.mock.calls).toEqual([[1], [-1]]);
});
it('leaves text entry, modifiers, composition and modal dialogs alone', () => {
  for (const props of [{ target: new Target(true) }, { metaKey: true }, { ctrlKey: true }, { altKey: true }, { isComposing: true }, { defaultPrevented: true }]) {
    key('g', props); key('g', props); key('n', props);
  }
  modal = true; key('g'); key('g'); key('n');
  expect(scrollTo).not.toHaveBeenCalled(); expect(next).not.toHaveBeenCalled();
});
it('an intervening key cancels the gg sequence', () => {
  key('g'); key('x'); key('g'); expect(scrollTo).not.toHaveBeenCalled();
});
