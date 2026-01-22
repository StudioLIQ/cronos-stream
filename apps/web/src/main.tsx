import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Home from './routes/Home';
import Viewer from './routes/Viewer';
import Overlay from './routes/Overlay';
import Dashboard from './routes/Dashboard';
import { ToastProvider, ToastHost } from './components/Toast';
import { StatusBar } from './components/StatusBar';
import { ThemeProvider } from './contexts/ThemeContext';
import { CommandPalette } from './components/CommandPalette';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

function ConditionalToastHost() {
  const location = useLocation();
  // Don't render toasts on the overlay page (OBS browser source)
  if (location.pathname.startsWith('/o/')) {
    return null;
  }
  return <ToastHost />;
}

function ConditionalStatusBar() {
  const location = useLocation();
  // Don't render status bar on the overlay page (OBS browser source)
  if (location.pathname.startsWith('/o/')) {
    return null;
  }
  return <StatusBar />;
}

function ConditionalCommandPalette() {
  const location = useLocation();
  // Don't render command palette on the overlay page (OBS browser source)
  if (location.pathname.startsWith('/o/')) {
    return null;
  }
  return <CommandPalette />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
    <ThemeProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/v/:slug" element={<Viewer />} />
            <Route path="/o/:slug" element={<Overlay />} />
            <Route path="/d/:slug" element={<Dashboard />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <ConditionalToastHost />
          <ConditionalStatusBar />
          <ConditionalCommandPalette />
        </BrowserRouter>
      </ToastProvider>
    </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
