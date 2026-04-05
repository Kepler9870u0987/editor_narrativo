import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { AppProviders } from './app/providers';
import '@blocknote/core/style.css';
import '@blocknote/mantine/style.css';
import './styles/app.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>,
);
