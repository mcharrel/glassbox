import { describe, expect, it, vi } from 'vitest';
import { commentAnchor } from '../../../src/client/workspace/commentAnchor.js';

describe('current remote comment anchors', () => {
  it.each([null, undefined, 0, -1])('omits a remote comment without a current line (%s)', line => {
    const view = { querySelector: vi.fn() };
    expect(commentAnchor(view as never, { line } as never)).toBeNull();
    expect(view.querySelector).not.toHaveBeenCalled();
  });
  it('matches old coordinates on unified context rows and current coordinates on normal rows', () => {
    const row = {};
    const view = { querySelector: vi.fn(() => row) };
    expect(commentAnchor(view as never, { line: 12, side: 'old' } as never)).toBe(row);
    expect(view.querySelector).toHaveBeenCalledWith('.diff-line[data-old-line="12"], .diff-line[data-side="old"][data-line="12"]');
    expect(commentAnchor(view as never, { line: 25 } as never)).toBe(row);
    expect(view.querySelector).toHaveBeenLastCalledWith('.diff-line[data-new-line="25"], .diff-line[data-side="new"][data-line="25"]');
  });
  it('omits an unmatched positive line rather than guessing a location', () => {
    expect(commentAnchor({ querySelector: () => null } as never, { line: 999 } as never)).toBeNull();
  });
});
