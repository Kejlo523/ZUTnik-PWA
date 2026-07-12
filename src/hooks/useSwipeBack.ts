import type React from 'react';
import { useCallback, useRef } from 'react';

interface SwipeHandlers {
  onTouchStart: (e: React.TouchEvent<HTMLElement>) => void;
  onTouchMove: (e: React.TouchEvent<HTMLElement>) => void;
  onTouchEnd: (e: React.TouchEvent<HTMLElement>) => void;
  onTouchCancel: () => void;
}

interface UseSwipeOptions {
  canGoBack: boolean;
  onBack: () => void;
  canOpenDrawer: boolean;
  onOpenDrawer: () => void;
  canCloseDrawer?: boolean;
  onCloseDrawer?: () => void;
}

const INTERACTIVE_TAGS = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL']);
const EDGE_SWIPE_WIDTH = 32;

function isInteractiveTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof Element)) return false;
  const node = el as Element;
  if (node.classList.contains('drawer-backdrop')) return false;
  if (node.closest('.plan-carousel-track')) return true;
  if (INTERACTIVE_TAGS.has(node.tagName)) return true;
  if (node.getAttribute('role') === 'button') return true;
  return false;
}

export function useSwipeGestures({ canGoBack, onBack, canOpenDrawer, onOpenDrawer, canCloseDrawer, onCloseDrawer }: UseSwipeOptions): SwipeHandlers {
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const blocked = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent<HTMLElement>) => {
    if (e.touches.length !== 1) return;

    const x = e.touches[0].clientX;
    const fromEdge = x <= EDGE_SWIPE_WIDTH;

    // Components such as the plan own their gestures. The narrow left edge stays
    // available for opening the drawer without stealing normal scrolling.
    if (!fromEdge && isInteractiveTarget(e.target)) {
      blocked.current = true;
      return;
    }

    blocked.current = false;
    startX.current = x;
    startY.current = e.touches[0].clientY;
  }, []);

  const onTouchMove = useCallback(() => {
    // nothing — we decide on touchEnd
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent<HTMLElement>) => {
    if (blocked.current) { blocked.current = false; return; }
    if (startX.current === null || startY.current === null) return;

    const origX = startX.current;
    const dx = e.changedTouches[0].clientX - origX;
    const dy = Math.abs(e.changedTouches[0].clientY - startY.current);
    startX.current = null;
    startY.current = null;

    // Reject if mostly vertical (unless it's a very clear horizontal swipe)
    if (dy > Math.abs(dx) && dy > 40) return;

    // Swipe left anywhere -> close drawer
    if (dx < -40 && canCloseDrawer && onCloseDrawer) {
      onCloseDrawer();
      return;
    }

    // Swipe right from the system-style left edge to open the drawer.
    if (origX <= EDGE_SWIPE_WIDTH && dx > 40 && canOpenDrawer) {
      onOpenDrawer();
      return;
    }

    // Swipe right (back) from very left edge
    if (dx > 80 && dy < 70 && origX <= EDGE_SWIPE_WIDTH && canGoBack) {
      onBack();
    }
  }, [canCloseDrawer, canGoBack, canOpenDrawer, onBack, onCloseDrawer, onOpenDrawer]);

  const onTouchCancel = useCallback(() => {
    startX.current = null;
    startY.current = null;
    blocked.current = false;
  }, []);

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel };
}

// Legacy compat
export function useSwipeBack(enabled: boolean, onBack: () => void) {
  return useSwipeGestures({
    canGoBack: enabled,
    onBack,
    canOpenDrawer: false,
    onOpenDrawer: () => { },
  });
}
