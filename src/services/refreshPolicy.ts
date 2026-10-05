export const MANUAL_COOLDOWN = 5 * 60_000;
export type ResourceModule = 'plan' | 'grades' | 'finance' | 'info' | 'news' | 'studies';
export interface RefreshLedger { lastAttempt: number; lastManual: number; retryAt: number; failures: number; }
export function decideRefresh(ledger: RefreshLedger, { now, manual, online, fresh, hasCache }: { now: number; manual: boolean; online: boolean; fresh: boolean; hasCache: boolean }): { allow: boolean; reason: string } {
  if (!online) return { allow: false, reason: 'offline' };
  if (manual && ledger.lastManual > 0 && now - ledger.lastManual < MANUAL_COOLDOWN) return { allow: false, reason: 'cooldown' };
  if (ledger.retryAt > now) return { allow: false, reason: 'backoff' };
  if (!manual && fresh) return { allow: false, reason: 'fresh' };
  if (!manual && hasCache && ledger.lastAttempt > 0 && now - ledger.lastAttempt < MANUAL_COOLDOWN) return { allow: false, reason: 'recent' };
  return { allow: true, reason: manual ? 'manual' : 'stale-or-missing' };
}

const empty: RefreshLedger = { lastAttempt: 0, lastManual: 0, retryAt: 0, failures: 0 };
const active = new Set<string>();
function key(scope: string, module: ResourceModule) { return `zutnik_refresh:${scope}:${module}`; }
function load(scope: string, module: ResourceModule): RefreshLedger {
  try { return { ...empty, ...JSON.parse(localStorage.getItem(key(scope, module)) || '{}') }; } catch { return { ...empty }; }
}
function save(scope: string, module: ResourceModule, ledger: RefreshLedger) {
  try { localStorage.setItem(key(scope, module), JSON.stringify(ledger)); } catch { /* Private mode can deny persistence. */ }
}
export function beginRefresh(scope: string, module: ResourceModule, manual: boolean, fresh: boolean, hasCache: boolean) {
  if (module !== 'plan' && active.has(key(scope, module))) return { allow: false, reason: 'inflight' };
  const ledger = load(scope, module);
  const decision = decideRefresh(ledger, { now: Date.now(), manual, online: navigator.onLine, fresh, hasCache });
  if (decision.allow) {
    if (module !== 'plan') active.add(key(scope, module));
    save(scope, module, { ...ledger, lastAttempt: Date.now(), lastManual: manual ? Date.now() : ledger.lastManual });
  }
  return decision;
}
export function finishRefresh(scope: string, module: ResourceModule, success: boolean) {
  active.delete(key(scope, module));
  const ledger = load(scope, module);
  const failures = success ? 0 : ledger.failures + 1;
  save(scope, module, { ...ledger, failures, retryAt: success ? 0 : Date.now() + Math.min(6 * 3_600_000, MANUAL_COOLDOWN * 2 ** (failures - 1)) });
}
