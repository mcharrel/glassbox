import { expect, it } from 'vitest';
import { readGitStorage, writeGitStorage } from '../../../src/workspace/lifecycle.js';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
it('allows concurrent imports, fences deletion behind them and blocks later imports until deletion finishes', async () => {
  const imports = deferred(), deleting = deferred(), events: string[] = [];
  const first = readGitStorage(async () => { events.push('read1'); await imports.promise; });
  const second = readGitStorage(async () => { events.push('read2'); await imports.promise; });
  const writer = writeGitStorage(async () => { events.push('delete'); await deleting.promise; });
  const later = readGitStorage(async () => { events.push('read3'); });
  await Promise.resolve(); await Promise.resolve();
  expect(events).toEqual(['read1', 'read2']);
  imports.resolve(); await Promise.all([first, second]);
  await new Promise(resolve => { setTimeout(resolve, 0); });
  expect(events).toEqual(['read1', 'read2', 'delete']);
  deleting.resolve(); await Promise.all([writer, later]);
  expect(events).toEqual(['read1', 'read2', 'delete', 'read3']);
});
it('serializes writers and releases the fence after failed reads and deletes', async () => {
  const events: string[] = [];
  const reader = readGitStorage(async () => { throw new Error('fetch failed'); });
  const writer = writeGitStorage(async () => { events.push('delete1'); throw new Error('unsafe workspace'); });
  const second = writeGitStorage(async () => { events.push('delete2'); });
  const later = readGitStorage(async () => { events.push('read'); });
  await Promise.allSettled([reader, writer, second, later]);
  expect(events).toEqual(['delete1', 'delete2', 'read']);
});
