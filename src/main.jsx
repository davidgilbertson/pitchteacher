import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './style.css';

const root = createRoot(document.getElementById('root'));
root.render(<App />);

// Register a scoped service worker that only caches soundfont assets.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    try {
      navigator.serviceWorker.register('/sw.js');
    } catch {}
  });
}
