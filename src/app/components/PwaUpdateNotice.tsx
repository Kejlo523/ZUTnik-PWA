import { useRegisterSW } from 'virtual:pwa-register/react';
import { Ic } from '../ui';

export function PwaUpdateNotice() {
  const { needRefresh: [ready, setReady], updateServiceWorker } = useRegisterSW({ immediate: true });
  if (!ready) return null;
  return <div className="pwa-update" role="status">
    <span>Dostępna aktualizacja</span>
    <button className="text-btn" onClick={() => void updateServiceWorker(true)}><Ic n="refresh" />Aktualizuj</button>
    <button className="icon-btn" aria-label="Przypomnij przy następnym uruchomieniu" onClick={() => setReady(false)}><Ic n="x" /></button>
  </div>;
}
