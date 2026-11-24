import React from 'react';
import { createRoot } from 'react-dom/client';
import '../client/styles/ppt-studio.css';
import { DesktopShell } from './DesktopShell';

declare global {
  interface Window {
    __DSH_PREVIEW_READY__?: boolean;
  }
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <DesktopShell />
    </React.StrictMode>,
  );

  const params = new URLSearchParams(window.location.search);
  if (params.get('screenshot') === '1') {
    const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
    void fontsReady.then(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.__DSH_PREVIEW_READY__ = true;
        });
      });
    });
  }
}
