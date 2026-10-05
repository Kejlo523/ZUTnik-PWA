import { useLayoutEffect, type RefObject } from 'react';

export function useScreenMotion(ref: RefObject<HTMLElement | null>, screen: string) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element?.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = element.animate([
      { opacity: 0, transform: 'translate3d(0, 6px, 0)' },
      { opacity: 1, transform: 'translate3d(0, 0, 0)' },
    ], { duration: 200, easing: 'cubic-bezier(.16,1,.3,1)' });
    return () => animation.cancel();
  }, [ref, screen]);
}
