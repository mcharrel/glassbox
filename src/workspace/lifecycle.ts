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
