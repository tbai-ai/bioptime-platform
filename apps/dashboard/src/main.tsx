import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@bioptime/design-system/tokens.css';
import '@bioptime/design-system/components.css';
import './styles/dashboard.css';
import { App } from './App';
import { AuthProvider } from './lib/auth';
import { ToastProvider } from './ui';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/">
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
