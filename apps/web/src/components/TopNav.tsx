import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

export function TopNav({ children }: { children?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" className="brand">
          Stream402
        </Link>
        {children}
      </div>
    </header>
  );
}

