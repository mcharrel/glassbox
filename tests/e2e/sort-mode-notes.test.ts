/** Regression coverage for GB-913/914: sidebar guidance reacts to mode changes
 *  and completed analysis without requiring a diff remount. */
import { test, expect } from '@playwright/test';

test.describe('GB-913 / GB-914: sidebar AI notes redraw on sort-mode switch and on analysis completion', () => {
  test('risk → narrative → folder redraws notes without a split/unified toggle', async ({ page }) => {
    // Captured after selecting a file so the stubbed scores anchor to the open file.
    let selectedFileId = '';

    // The request URLs carry a `?reviewId=…` query string, so each glob ends in
    // `**`. The `/status` route is registered LAST so it wins over the
    // risk/narrative result routes for the overlapping `…/risk/status` URL
    // (Playwright uses the most recently registered matching route).
    await page.route('**/api/ai/analyze**', async (route) => {
      await route.fulfill({ json: { analysisId: 'test-analysis', status: 'running' } });
    });
    await page.route('**/api/ai/analysis/risk**', async (route) => {
      await route.fulfill({ json: {
        status: 'completed',
        scores: [{ reviewFileId: selectedFileId, filePath: 'x', sortOrder: 0, aggregateScore: 0.8, rationale: 'r', dimensionScores: { aggregate: 0.8 }, notes: { overview: 'RISKOVERVIEWMARKER', lines: [] } }],
      } });
    });
    await page.route('**/api/ai/analysis/narrative**', async (route) => {
      await route.fulfill({ json: {
        status: 'completed',
        scores: [{ reviewFileId: selectedFileId, filePath: 'x', sortOrder: 0, rationale: 'r', notes: { overview: 'NARRATIVEOVERVIEWMARKER', lines: [] } }],
      } });
    });
    await page.route('**/api/ai/analysis/*/status**', async (route) => {
      await route.fulfill({ json: { status: 'completed', progressCompleted: 1, progressTotal: 1 } });
    });

    await page.goto('/');
    const firstFile = page.locator('.file-item').first();
    await expect(firstFile).toBeVisible();
    selectedFileId = (await firstFile.getAttribute('data-file-id')) ?? '';
    expect(selectedFileId).not.toBe('');

    await firstFile.click();
    await expect(page.locator('#diff-container .diff-view').first()).toBeVisible();

    const riskNote = page.locator('#sidebar-ai-notes .sidebar-ai-note.ai-note-risk');
    const narrativeNote = page.locator('#sidebar-ai-notes .sidebar-ai-note.ai-note-narrative');

    // Normalize to folder mode (the persisted sort mode may be anything) — no
    // sort-mode overview notes should show. Guided-review notes, if enabled in
    // the ambient config, are a different class and are ignored throughout.
    await page.locator('[data-sort-mode="folder"]').click();
    await expect(riskNote).toHaveCount(0);
    await expect(narrativeNote).toHaveCount(0);

    // Switch to risk → the risk overview renders reactively. Before the fix this
    // stayed empty until a split/unified toggle forced a diff refetch.
    await page.locator('[data-sort-mode="risk"]').click();
    await expect(riskNote).toHaveCount(1, { timeout: 8000 });
    await expect(riskNote).toContainText('RISKOVERVIEWMARKER');

    // Switch to narrative → the stale risk note is cleared and the narrative
    // note appears, again with no diff refetch.
    await page.locator('[data-sort-mode="narrative"]').click();
    await expect(narrativeNote).toContainText('NARRATIVEOVERVIEWMARKER', { timeout: 8000 });
    await expect(riskNote).toHaveCount(0);

    // Back to folder → the sort-mode overview notes clear.
    await page.locator('[data-sort-mode="folder"]').click();
    await expect(riskNote).toHaveCount(0);
    await expect(narrativeNote).toHaveCount(0);
  });
});
