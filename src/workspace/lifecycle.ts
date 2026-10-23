const operations = new Map<string, Promise<unknown>>();
export const closingTabs = new WeakSet();

/** Finish imports that may already have borrowed a closing tab's Git objects. */
export async function waitForCheckouts(): Promise<void> {
  await Promise.allSettled([...operations.values()]);
}

/** Import, restoration and expiry must never change the same checkout concurrently. */
export async function withCheckoutLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const pending = (operations.get(key) ?? Promise.resolve()).catch(() => {}).then(run);
  operations.set(key, pending);
  try { return await pending; }
  finally { if (operations.get(key) === pending) operations.delete(key); }
}

export function checkoutBusy(key: string): boolean { return operations.has(key); }

let storageWrites: Promise<unknown> = Promise.resolve();
const storageReads = new Set<Promise<unknown>>();

/** Imports may run together, but object relocation/deletion waits for their Git processes. */
export async function readGitStorage<T>(run: () => Promise<T>): Promise<T> {
  const pending = storageWrites.catch(() => {}).then(run);
  storageReads.add(pending);
  try { return await pending; }
  finally { storageReads.delete(pending); }
}
export async function writeGitStorage<T>(run: () => Promise<T>): Promise<T> {
  const readers = [...storageReads];
  const pending = storageWrites.catch(() => {}).then(() => Promise.allSettled(readers)).then(run);
  storageWrites = pending.catch(() => {});
  return pending;
}
