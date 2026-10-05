import { useLayoutEffect, useRef } from 'react';

export function useLoadingReveal<T extends HTMLElement>(pending: boolean) {
  const element = useRef<T>(null);
  const wasPending = useRef(false);
  useLayoutEffect(() => {
    const reveal = wasPending.current && !pending;
    wasPending.current = pending;
    if (!reveal || !element.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = element.current.animate([
      { opacity: 0, transform: 'translateY(7px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 240, easing: 'cubic-bezier(.16,1,.3,1)' });
    return () => animation.cancel();
  }, [pending]);
  return element;
}
