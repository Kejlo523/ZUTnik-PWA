import type { InstallPlatform } from '../../hooks/usePwaInstall';
import { LOGO_SRC } from '../constants';
import type { TranslateFn } from '../viewTypes';
import { Ic } from '../ui';
import { Sheet } from './Sheet';

export function PwaInstallSheet({ platform, onClose, t }: {
  platform: InstallPlatform; onClose: () => void; t: TranslateFn;
}) {
  const { kind, needsBrowserSwitch } = platform;
  const icons = kind === 'ios' ? ['share', 'plus', 'check']
    : kind === 'mac-safari' ? ['menu', 'plus', 'check'] : ['more', 'download', 'check'];
  return <Sheet title={t('install.action')} onClose={onClose} className="pwa-install-sheet">
    <div className="pwa-install-identity">
      <img src={LOGO_SRC} alt="" width={52} height={52} />
      <div><strong>ZUTnik</strong><span>{t(`install.target.${kind}`)}</span></div>
    </div>
    {!window.isSecureContext && <p className="pwa-install-note pwa-install-warning" role="note"><Ic n="lock" /><span>{t('install.httpsRequired')}</span></p>}
    {needsBrowserSwitch && <p className="pwa-install-note"><Ic n="external" /><span>{t(kind === 'ios' ? 'install.openSafari' : 'install.openSupportedBrowser')}</span></p>}
    <ol className="pwa-install-steps" role="list">
      {icons.map((icon, index) => <li key={index}>
        <span className="pwa-install-step-icon"><Ic n={icon} /></span>
        <span>{t(`install.${kind}.step${index + 1}`)}</span>
      </li>)}
    </ol>
    {kind === 'mac-safari' && <p className="pwa-install-compatibility">{t('install.macRequirement')}</p>}
    <button type="button" className="primary-btn pwa-install-done" onClick={onClose}><Ic n="check" />{t('install.done')}</button>
  </Sheet>;
}
