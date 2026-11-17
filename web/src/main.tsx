import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './lib/i18n';
import '@fontsource-variable/rubik/wght.css';
import './index.css';
import App from './App.tsx';
import { showViewportDebug } from './lib/viewportDebug';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// ?vp=1 prints the viewport numbers on screen (see lib/viewportDebug.ts).
if (new URLSearchParams(location.search).has('vp')) showViewportDebug();
