import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import AppErrorBoundary from './components/AppErrorBoundary';
import './index.css';
import './components/WorkspaceUI.css';
import './components/DashboardInteriors.css';
import './components/PerformanceUI.css';
import './components/AePerformanceUI.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
);
