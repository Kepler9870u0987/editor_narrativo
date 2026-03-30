import { jsx as _jsx } from "react/jsx-runtime";
import { BrowserRouter } from 'react-router-dom';
import { AppRouter } from './router';
export function App() {
    return (_jsx(BrowserRouter, { children: _jsx(AppRouter, {}) }));
}
//# sourceMappingURL=App.js.map