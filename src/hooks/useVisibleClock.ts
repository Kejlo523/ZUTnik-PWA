import { useEffect, useState } from 'react';

export function useVisibleClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timer);
      if (document.hidden) return;
      setNow(new Date());
      timer = setTimeout(schedule, 60_000 - Date.now() % 60_000);
    };
    timer = setTimeout(schedule, 60_000 - Date.now() % 60_000);
    document.addEventListener('visibilitychange', schedule);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', schedule); };
  }, []);
  return now;
}
