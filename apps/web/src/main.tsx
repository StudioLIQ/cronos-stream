import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Viewer from './routes/Viewer';
import Overlay from './routes/Overlay';
import Dashboard from './routes/Dashboard';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/v/:slug" element={<Viewer />} />
        <Route path="/o/:slug" element={<Overlay />} />
        <Route path="/d/:slug" element={<Dashboard />} />
        <Route path="/" element={<Navigate to="/v/demo" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
