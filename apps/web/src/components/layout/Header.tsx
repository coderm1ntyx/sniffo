import { ArrowRight } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { PrimaryButton } from '../ui/PrimaryButton';
import fox from '../../assets/logo/logo-fox.png';
import wordmark from '../../assets/logo/logo-text.png';

export function SniffoBrand() {
  return (
    <Link to="/" className="landing-brand" aria-label="Sniffo home">
      <img src={fox} width="1312" height="1199" alt="" />
      <img src={wordmark} width="2172" height="724" alt="Sniffo" />
    </Link>
  );
}

export function Header() {
  const { pathname } = useLocation();

  return (
    <header
      className={
        pathname === '/check' || pathname === '/results'
          ? 'landing-header landing-container landing-header--check'
          : 'landing-header landing-container'
      }
    >
      <SniffoBrand />
      <nav aria-label="Main navigation" className="landing-nav">
        <Link to="/#how-it-works">How It Works</Link>
        <Link to="/#why-it-matters">Why It Matters</Link>
        <Link to="/#faq">FAQ</Link>
      </nav>
      <PrimaryButton
        to={pathname === '/results' ? '/check?new=1' : '/check'}
        className="landing-header-cta"
      >
        {pathname === '/results' ? 'Check another listing' : 'Get Started'}{' '}
        <ArrowRight size={17} aria-hidden="true" />
      </PrimaryButton>
    </header>
  );
}
