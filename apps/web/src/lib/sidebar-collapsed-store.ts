// A tiny external store for the desktop sidebar's collapsed/expanded
// preference, backed by localStorage. Deliberately NOT a plain
// useState+useEffect pair — this repo's ESLint rules forbid calling
// setState synchronously inside an effect body (cascading-render risk),
// and localStorage's own 'storage' event never fires in the tab that made
// the change, so a toggle button in the same tab needs a real, manually
// notified subscriber list to update immediately. useSyncExternalStore is
// the React-documented tool for exactly this shape of problem.
const STORAGE_KEY = "vercentlabs:sidebar-collapsed";
const listeners = new Set<() => void>();
let cached: boolean | null = null;

function read(): boolean {
  if (cached !== null) return cached;
  cached = typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) === "1";
  return cached;
}

export function subscribeSidebarCollapsed(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function getSidebarCollapsedSnapshot(): boolean {
  return read();
}

export function getSidebarCollapsedServerSnapshot(): boolean {
  return false;
}

export function setSidebarCollapsed(next: boolean): void {
  cached = next;
  window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  for (const listener of listeners) listener();
}
