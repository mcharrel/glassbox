import { expect, it } from 'vitest';
import { hasVisibleClient, reportVisibility } from '../../../src/workspace/notifications.js';
it('suppresses notifications for a visible client, resumes when hidden, and expires closed clients', () => {
  reportVisibility('a', true, 100);
  expect(hasVisibleClient(200)).toBe(true);
  reportVisibility('a', false, 300);
  expect(hasVisibleClient(400)).toBe(false);
  reportVisibility('a', true, 500); reportVisibility('b', false, 600);
  expect(hasVisibleClient(700)).toBe(true);
  expect(hasVisibleClient(30500)).toBe(false);
});
