import { clampNotesHeight } from '../../../src/client/sidebar/notesResize.js';
it.each([[300, 700, 300], [900, 700, 600], [-100, 700, 60], [300, 140, 40], [300, 50, 0], [0, 0, 0]])('bounds notes height %i in available space %i to %i', (height, available, expected) => {
  expect(clampNotesHeight(height, available)).toBe(expected);
});
