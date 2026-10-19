import { expect, it } from 'vitest';
import { hasCodeFocus, hasVisibleClient, reportVisibility } from '../../../src/workspace/notifications.js';
it('suppresses notifications for a visible client, resumes when hidden, and expires closed clients', () => {
  reportVisibility('a', true, 100);
  expect(hasVisibleClient(200)).toBe(true);
  reportVisibility('a', false, 300);
  expect(hasVisibleClient(400)).toBe(false);
  reportVisibility('a', true, 500); reportVisibility('b', false, 600);
  expect(hasVisibleClient(700)).toBe(true);
  expect(hasVisibleClient(30500)).toBe(false);
});

it('protects only focused code, including other windows, and expires abandoned clients', () => {
  const now = 100000;
  reportVisibility('file', true, now, 'one');
  reportVisibility('main', true, now, null);
  expect(hasCodeFocus('one', now)).toBe(true);
  expect(hasCodeFocus('two', now)).toBe(false);
  reportVisibility('second-window', true, now, 'two');
  reportVisibility('file', false, now + 1, null);
  expect(hasCodeFocus('one', now + 2)).toBe(false);
  expect(hasCodeFocus('two', now + 2)).toBe(true);
  expect(hasCodeFocus('two', now + 30000)).toBe(false);
});
it('protects unfinished drafts even while hidden without suppressing notifications', () => {
  const now = 200000;
  reportVisibility('draft', false, now, null, 'one');
  expect(hasCodeFocus('one', now)).toBe(true);
  expect(hasVisibleClient(now)).toBe(false);
  reportVisibility('draft', false, now + 1, null, null);
  expect(hasCodeFocus('one', now + 1)).toBe(false);
});
it('conservatively protects visible legacy clients until they leave', () => {
  reportVisibility('legacy', true, 300000);
  expect(hasCodeFocus('any', 300001)).toBe(true);
  reportVisibility('legacy', false, 300002);
  expect(hasCodeFocus('any', 300003)).toBe(false);
});
