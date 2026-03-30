import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function PageShell({ title, subtitle, aside, children, }) {
    return (_jsx("div", { className: "page-shell", children: _jsxs("div", { className: "page-shell__main", children: [_jsxs("header", { className: "page-shell__header", children: [_jsxs("div", { children: [_jsx("h1", { children: title }), subtitle ? _jsx("p", { children: subtitle }) : null] }), aside] }), _jsx("section", { className: "page-shell__content", children: children })] }) }));
}
//# sourceMappingURL=page-shell.js.map