import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';

export interface ScreenEntry<TScreen extends string = string, TParams = unknown> {
  key: TScreen;
  params?: TParams;
  id: number;
}

const EXIT_EVENT = 'zutnik-exit-attempt';
const LAST_SCREEN_KEY = 'zutnik_last_screen';

interface UseAppNavigationOptions {
  onBackAttemptRef?: MutableRefObject<(() => boolean) | null>;
  onRootBackAttemptRef?: MutableRefObject<(() => boolean) | null>;
}

export function useAppNavigation<TScreen extends string>(
  initialScreen: TScreen,
  options?: UseAppNavigationOptions,
) {
  const idRef = useRef(1);

  // Try to load the last screen strictly if it wasn't a manual reset during boot
  const storedScreen = window.localStorage.getItem(LAST_SCREEN_KEY) as TScreen | null;
  const startScreen = (storedScreen && initialScreen === 'home') ? storedScreen : initialScreen;

  const [stack, setStack] = useState<ScreenEntry<TScreen>[]>([{ key: startScreen, id: 1 }]);
  const stackRef = useRef(stack);

  useEffect(() => {
    stackRef.current = stack;
    const currentKey = stack[stack.length - 1].key;
    if (currentKey !== 'login') {
      window.localStorage.setItem(LAST_SCREEN_KEY, currentKey);
    }
  }, [stack]);

  useEffect(() => {
    const marker = { zutnik: true, ts: Date.now() };
    window.history.replaceState(marker, '', window.location.href);
    window.history.pushState(marker, '', window.location.href);

    const onPopState = () => {
      if (options?.onBackAttemptRef?.current?.()) {
        window.history.pushState({ zutnik: true, ts: Date.now() }, '', window.location.href);
        return;
      }

      if (stackRef.current.length > 1) {
        setStack((prev) => prev.slice(0, -1));
        return;
      }

      if (options?.onRootBackAttemptRef?.current?.()) {
        window.history.pushState({ zutnik: true, ts: Date.now() }, '', window.location.href);
        return;
      }

      window.dispatchEvent(new CustomEvent(EXIT_EVENT));
      window.history.pushState({ zutnik: true, ts: Date.now() }, '', window.location.href);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [options?.onBackAttemptRef, options?.onRootBackAttemptRef]);

  const push = useCallback((key: TScreen, params?: unknown) => {
    idRef.current += 1;
    window.history.pushState({ zutnik: true, ts: Date.now() }, '', window.location.href);
    setStack((prev) => [...prev, { key, params, id: idRef.current }]);
  }, []);

  const reset = useCallback((key: TScreen, params?: unknown) => {
    idRef.current += 1;
    setStack([{ key, params, id: idRef.current }]);
    window.history.replaceState({ zutnik: true, ts: Date.now() }, '', window.location.href);
    window.history.pushState({ zutnik: true, ts: Date.now() }, '', window.location.href);
  }, []);

  const goBack = useCallback(() => {
    if (stackRef.current.length > 1) {
      window.history.back();
    }
  }, []);

  const navigateTo = useCallback((key: TScreen, baseScreen: TScreen, params?: unknown) => {
    const baseId = ++idRef.current;
    const targetId = ++idRef.current;
    setStack([
      { key: baseScreen, id: baseId },
      { key, params, id: targetId },
    ]);
    window.history.replaceState({ zutnik: true, ts: Date.now() }, '', window.location.href);
    window.history.pushState({ zutnik: true, ts: Date.now() }, '', window.location.href);
    window.history.pushState({ zutnik: true, ts: Date.now() }, '', window.location.href);
  }, []);

  const current = stack[stack.length - 1];

  return useMemo(() => ({
    stack,
    current,
    canGoBack: stack.length > 1,
    push,
    reset,
    navigateTo,
    goBack,
  }), [stack, current, push, reset, navigateTo, goBack]);
}

export function useExitAttemptToast(handler: () => void) {
  useEffect(() => {
    const listener = () => handler();
    window.addEventListener(EXIT_EVENT, listener);
    return () => window.removeEventListener(EXIT_EVENT, listener);
  }, [handler]);
}
