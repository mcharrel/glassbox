import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { apiCall } from '../../../src/api/_runner.js';
import { changeWorkspace, getWorkspace, reportVisibility } from '../../../src/api/workspace.js';

afterEach(() => vi.unstubAllGlobals());

it('can poll and open another PR while the selected PR has no review yet', async () => {
  vi.stubGlobal('document', { body: { dataset: { reviewId: '' } } });
  const fetch = vi.fn(async () => Response.json({ tabs: [], active: null }));
  vi.stubGlobal('fetch', fetch);
  await getWorkspace();
  await changeWorkspace({ op: 'open', url: 'https://github.com/example/project/pull/2' });
  expect(fetch.mock.calls.map(call => call[0])).toEqual(['/api/workspace', '/api/workspace']);
});

it('keeps workspace requests independent of a stale selection but scopes searches and attachments', async () => {
  vi.stubGlobal('document', { body: { dataset: { reviewId: 'old-review' } } });
  const fetch = vi.fn(async () => Response.json({ tabs: [], active: null, ok: true }));
  vi.stubGlobal('fetch', fetch);
  await getWorkspace();
  await reportVisibility({ id: 'window', visible: true });
  await changeWorkspace({ op: 'open', url: 'https://github.com/example/project/pull/1', attachReviewId: 'attached' });
  await apiCall(z.unknown(), '/workspace/search?q=name');
  expect(fetch.mock.calls.map(call => call[0])).toEqual([
    '/api/workspace', '/api/workspace/visibility', '/api/workspace?reviewId=attached', '/api/workspace/search?q=name&reviewId=old-review',
  ]);
});

it('shows the actual failed response instead of a WebKit JSON syntax error', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('Review not found', { status: 404 })));
  await expect(apiCall(z.unknown(), '/workspace', { reviewId: null })).rejects.toThrow('Request to /workspace failed (404): Review not found');
});
