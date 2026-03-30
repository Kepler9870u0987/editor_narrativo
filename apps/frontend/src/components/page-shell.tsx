import type { PropsWithChildren, ReactNode } from 'react';

export function PageShell({
  title,
  subtitle,
  aside,
  children,
}: PropsWithChildren<{
  title: string;
  subtitle?: string;
  aside?: ReactNode;
}>) {
  return (
    <div className="page-shell">
      <div className="page-shell__main">
        <header className="page-shell__header">
          <div>
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {aside}
        </header>
        <section className="page-shell__content">{children}</section>
      </div>
    </div>
  );
}
