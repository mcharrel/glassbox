import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ update: vi.fn(), tab: vi.fn(() => ({})) }));
vi.mock('../../../src/workspace/service.js', () => ({ tabForReview: mocks.tab, assertOwnAnnotation: vi.fn(), queueAnnotation: vi.fn(), queueAnnotationChange: vi.fn() }));
vi.mock('../../../src/db/queries.js', () => ({ updateAnnotation: mocks.update }));
vi.mock('../../../src/export/auto-export.js', () => ({ scheduleAutoExport: vi.fn() }));
import { annotationsRoutes } from '../../../src/routes/api/annotations.js';
import type { AppEnv } from '../../../src/types.js';
it('rejects posted PR annotation edits even from an older client without changing stored content', async () => {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => { c.set('reviewId', 'review'); await next(); });
  app.route('/', annotationsRoutes);
  const result = await app.request('/annotations/comment', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Changed request', category: 'note' }) });
  expect(result.status).toBe(409);
  expect(await result.json()).toEqual({ error: 'Posted comments cannot be edited. Add a reply instead.' });
  expect(mocks.update).not.toHaveBeenCalled();
});
