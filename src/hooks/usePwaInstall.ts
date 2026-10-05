import { useCallback, useEffect, useRef, useState } from 'react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void> | void;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallPlatform {
  kind: 'ios' | 'android' | 'mac-safari' | 'desktop';
  needsBrowserSwitch: boolean;
}

function detectPlatform(): InstallPlatform {
  const agent = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(agent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const safari = /safari/i.test(agent) && !/chrome|chromium|crios|fxios|edg|opr|opios|android/i.test(agent);
  if (ios) return { kind: 'ios', needsBrowserSwitch: !safari };
  if (/android/i.test(agent)) return { kind: 'android', needsBrowserSwitch: false };
  if (/mac/i.test(agent) && safari) return { kind: 'mac-safari', needsBrowserSwitch: false };
  return { kind: 'desktop', needsBrowserSwitch: !/chrome|chromium|edg|opr/i.test(agent) };
}

function inAppMode() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: minimal-ui)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function usePwaInstall() {
  const [platform] = useState(detectPlatform);
  const [installed, setInstalled] = useState(inAppMode);
  const [busy, setBusy] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const deferred = useRef<InstallPromptEvent | null>(null);
  const pending = useRef(false);
  const closeGuide = useCallback(() => setGuideOpen(false), []);

  useEffect(() => {
    const receivePrompt = (event: Event) => {
      const prompt = event as InstallPromptEvent;
      if (typeof prompt.prompt !== 'function' || !prompt.userChoice) return;
      event.preventDefault();
      deferred.current = prompt;
    };
    const onInstalled = () => {
      deferred.current = null;
      setInstalled(true);
      setGuideOpen(false);
    };
    const modeChanged = () => { if (inAppMode()) onInstalled(); };
    const modes = ['standalone', 'minimal-ui'].map((mode) => window.matchMedia(`(display-mode: ${mode})`));
    modes.forEach((mode) => mode.addEventListener('change', modeChanged));
    window.addEventListener('beforeinstallprompt', receivePrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      modes.forEach((mode) => mode.removeEventListener('change', modeChanged));
      window.removeEventListener('beforeinstallprompt', receivePrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (installed || pending.current) return;
    const prompt = deferred.current;
    if (!prompt || !window.isSecureContext) {
      setGuideOpen(true);
      return;
    }
    // A beforeinstallprompt event can only be used once, even after dismissal.
    deferred.current = null;
    pending.current = true;
    setBusy(true);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') {
        setInstalled(true);
        setGuideOpen(false);
      }
    } catch {
      setGuideOpen(true);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, [installed]);

  return { canOfferInstall: !installed, busy, install, platform, guideOpen, closeGuide };
}
