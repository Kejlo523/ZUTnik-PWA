import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import '@fontsource/roboto-condensed/600.css';
import '@fontsource/roboto-condensed/700.css';
import './index.css';
import App from './App';

const viewportMeta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
if (viewportMeta) {
  viewportMeta.content = 'width=device-width, initial-scale=1.0, viewport-fit=cover';
}

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(<App />);
