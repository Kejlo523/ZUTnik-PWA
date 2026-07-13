import { useEffect } from 'react';

const LOCK_CLASS = 'is-overscroll-locked';

let lockCount = 0;
let touchStartY = 0;
let listenersAttached = false;

function isScrollableOverflow(value: string): boolean {
  return value === 'auto' || value === 'scroll' || value === 'overlay';
}

function canScrollUpFromTarget(target: EventTarget | null): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== document.documentElement) {
    const style = window.getComputedStyle(node);
    const scrollable = isScrollableOverflow(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
    if (scrollable && node.scrollTop > 0) return true;
    node = node.parentElement;
  }
  return false;
}

function onTouchStart(event: TouchEvent) {
  touchStartY = event.touches[0]?.clientY ?? 0;
}

function onTouchMove(event: TouchEvent) {
  if (lockCount <= 0 || event.touches.length !== 1) return;
  if (canScrollUpFromTarget(event.target)) return;

  const currentY = event.touches[0].clientY;
  if (currentY <= touchStartY + 6) return;

  event.preventDefault();
}

function attachListeners() {
  if (listenersAttached) return;
  listenersAttached = true;
  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchmove', onTouchMove, { passive: false });
}

function detachListeners() {
  if (!listenersAttached) return;
  listenersAttached = false;
  document.removeEventListener('touchstart', onTouchStart);
  document.removeEventListener('touchmove', onTouchMove);
}

function acquireLock() {
  lockCount += 1;
  if (lockCount === 1) {
    document.documentElement.classList.add(LOCK_CLASS);
    attachListeners();
  }
}

function releaseLock() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.documentElement.classList.remove(LOCK_CLASS);
    detachListeners();
  }
}

export function useOverscrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    acquireLock();
    return () => releaseLock();
  }, [active]);
}

export function isOverscrollLocked(): boolean {
  return lockCount > 0 || document.documentElement.classList.contains(LOCK_CLASS);
}
