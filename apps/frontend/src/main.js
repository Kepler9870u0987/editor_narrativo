import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { AppProviders } from './app/providers';
import '@blocknote/core/style.css';
import '@blocknote/react/style.css';
import './styles/app.css';
ReactDOM.createRoot(document.getElementById('root')).render(_jsx(React.StrictMode, { children: _jsx(AppProviders, { children: _jsx(App, {}) }) }));
//# sourceMappingURL=main.js.map