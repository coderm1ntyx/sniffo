import type { ReactNode } from 'react';
import { Header } from './Header';
import { useLocation } from 'react-router-dom';
import { useEffect } from 'react';
export function PageLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  useEffect(() => {
    if (pathname !== '/') window.scrollTo({ top: 0 });
  }, [pathname]);
  if (pathname === '/') return <>{children}</>;
  return (
    <>
      <Header />
      <main>{children}</main>
      {pathname !== '/check' && pathname !== '/results' ? (
        <footer className="site-footer">
          A clearer view before you make a move.
        </footer>
      ) : null}
    </>
  );
}
