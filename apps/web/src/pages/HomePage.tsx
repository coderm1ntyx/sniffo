import { useEffect, useRef } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { ListingUrlEntry } from '../components/landing/ListingUrlEntry';
import hero from '../assets/landing/hero-desktop.png';
import property from '../assets/landing/property.png';
import windowArt from '../assets/landing/window.png';
import footer from '../assets/landing/footer.png';
import { Header, SniffoBrand } from '../components/layout/Header';
import '../styles/landing.css';

gsap.registerPlugin(ScrollTrigger, useGSAP);

const SECTION_REVEAL_START = 'top 92%';

export function HomePage() {
  const root = useRef<HTMLDivElement>(null);
  const report = useRef<HTMLDialogElement>(null);
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (pathname !== '/') return;
    if (!hash) {
      window.scrollTo({ top: 0 });
      return;
    }
    document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [pathname, hash]);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      try {
        media.add('(prefers-reduced-motion: no-preference)', () => {
          const intro = gsap.timeline({ defaults: { ease: 'power3.out' } });
          intro
            .from('.landing-header', { y: -10, opacity: 0, duration: 0.65 })
            .from(
              '.landing-hero .hero-line > span',
              { yPercent: 110, duration: 1, stagger: 0.12 },
              0.12,
            )
            .from(
              '.landing-hero .landing-copy',
              { opacity: 0, duration: 0.85, stagger: 0.1 },
              0.4,
            )
            .from(
              '.landing-hero .listing-entry',
              { y: 12, opacity: 0, duration: 0.75 },
              0.75,
            )
            .from(
              '.landing-hero-art',
              { x: 24, scale: 1.025, opacity: 0, duration: 1.5 },
              0.1,
            );
          const process = gsap.timeline({
            scrollTrigger: {
              trigger: '#how-it-works',
              start: SECTION_REVEAL_START,
              once: true,
            },
            defaults: { ease: 'power3.out' },
          });
          process
            .from('#process-title', { y: 12, opacity: 0, duration: 0.6 })
            .from(
              '.process-progress',
              {
                scaleX: 0,
                transformOrigin: 'left',
                duration: 1.2,
                ease: 'power2.inOut',
              },
              0.2,
            )
            .from(
              '.process-node',
              { scale: 0, duration: 0.35, stagger: 0.3, ease: 'power2.out' },
              0.35,
            )
            .from(
              '.process-label',
              { y: 8, opacity: 0, duration: 0.45, stagger: 0.3 },
              0.4,
            )
            .from('.process-note', { y: 8, opacity: 0, duration: 0.5 }, 0.85);
          const showcase = root.current?.querySelector('.landing-showcase');
          if (showcase) {
            gsap
              .timeline({
                scrollTrigger: {
                  trigger: showcase,
                  start: SECTION_REVEAL_START,
                  once: true,
                },
                defaults: { ease: 'power3.out' },
              })
              .from(showcase.querySelector('.editorial-art'), {
                x: -18,
                scale: 0.99,
                opacity: 0,
                duration: 1.15,
              })
              .from(
                showcase.querySelectorAll('.editorial-copy > *'),
                { y: 12, opacity: 0, duration: 0.65, stagger: 0.13 },
                0.18,
              );
          }

          const why = root.current?.querySelector('.landing-why');
          if (why) {
            gsap
              .timeline({
                scrollTrigger: {
                  trigger: why,
                  start: SECTION_REVEAL_START,
                  once: true,
                },
                defaults: { ease: 'power3.out' },
              })
              .from(why.querySelector('.editorial-eyebrow'), {
                y: 7,
                opacity: 0,
                duration: 0.45,
              })
              .from(
                why.querySelector('.editorial-copy h2'),
                { y: 14, opacity: 0, duration: 0.7 },
                0.16,
              )
              .from(
                why.querySelector('.editorial-copy .landing-copy'),
                { y: 10, opacity: 0, duration: 0.65 },
                0.42,
              )
              .from(
                why.querySelector('.editorial-art'),
                { y: 14, opacity: 0, duration: 1.1 },
                0.38,
              );
          }
          gsap
            .timeline({
              scrollTrigger: {
                trigger: '.landing-reassurance',
                start: SECTION_REVEAL_START,
                once: true,
              },
              defaults: { ease: 'power3.out' },
            })
            .from('.landing-reassurance h2', {
              y: 14,
              opacity: 0,
              duration: 0.7,
            })
            .from(
              '.landing-reassurance .landing-copy',
              { y: 8, opacity: 0, duration: 0.55 },
              0.28,
            );
          gsap
            .timeline({
              scrollTrigger: {
                trigger: '.landing-final',
                start: SECTION_REVEAL_START,
                once: true,
              },
              defaults: { ease: 'power3.out' },
            })
            .from(
              '.landing-final .hero-line > span',
              { yPercent: 105, duration: 0.85, stagger: 0.12 },
              0,
            )
            .from(
              '.landing-final .landing-copy',
              { y: 10, opacity: 0, duration: 0.65 },
              0.65,
            )
            .from(
              '.landing-final .listing-entry',
              { y: 8, opacity: 0, duration: 0.6 },
              0.95,
            )
            .from(
              '.landing-final-art',
              { x: 18, scale: 0.99, opacity: 0, duration: 1.05 },
              1.25,
            );
          gsap
            .timeline({
              scrollTrigger: {
                trigger: '.landing-faq',
                start: SECTION_REVEAL_START,
                once: true,
              },
              defaults: { ease: 'power3.out' },
            })
            .from('.landing-faq h2', { y: 12, opacity: 0, duration: 0.6 })
            .from(
              '.landing-faq .faq-list details',
              { y: 10, opacity: 0, duration: 0.55, stagger: 0.12 },
              0.18,
            );
          gsap
            .timeline({
              scrollTrigger: {
                trigger: '.landing-footer',
                start: SECTION_REVEAL_START,
                once: true,
              },
              defaults: { ease: 'power2.out' },
            })
            .from(
              '.landing-footer .landing-brand, .landing-footer nav a, .landing-footer > span',
              { y: 8, opacity: 0, duration: 0.45, stagger: 0.08 },
            );
        });
      } catch (error) {
        media.revert();
        console.warn(
          'Landing animation unavailable; showing the static page.',
          error,
        );
      }
      // Reserve image space in CSS; refresh measurements once lazy artwork and fonts settle.
      const refresh = () => ScrollTrigger.refresh();
      const images = root.current?.querySelectorAll('img');
      images?.forEach((img) => img.addEventListener('load', refresh));
      let mounted = true;
      void document.fonts.ready.then(() => {
        if (mounted) refresh();
      });
      return () => {
        mounted = false;
        images?.forEach((img) => img.removeEventListener('load', refresh));
        media.revert();
      };
    },
    { scope: root },
  );

  return (
    <div ref={root} className="sniffo-landing">
      <a className="landing-skip" href="#landing-content">
        Skip to content
      </a>
      <Header />
      <main id="landing-content" tabIndex={-1}>
        <section className="landing-hero" aria-labelledby="hero-title">
          <img
            className="landing-hero-art"
            src={hero}
            width="1536"
            height="1024"
            alt=""
            fetchPriority="high"
            decoding="async"
          />
          <div className="landing-container hero-content">
            <h1 id="hero-title">
              <span className="hero-line">
                <span>Sniff out </span>
              </span>
              <span className="hero-line">
                <span className="orange">rental red flags </span>
              </span>
              <span className="hero-line">
                <span>before you pay</span>
              </span>
            </h1>
            <p className="landing-copy">
              Sniffo helps you review rental listings, conversations, and
              agreements for inconsistencies and warning signs — before you send
              money.
            </p>
            <ListingUrlEntry />
          </div>
        </section>
        <section
          id="how-it-works"
          className="landing-process landing-container"
          aria-labelledby="process-title"
        >
          <h2 id="process-title">
            From listing <span className="orange">to clarity</span>
          </h2>
          <div className="process-timeline">
            <div className="process-track" aria-hidden="true">
              <span className="process-progress" />
            </div>
            <ol>
              {['Paste a listing', 'We analyze', 'Review findings'].map(
                (label) => (
                  <li key={label}>
                    <span className="process-node" aria-hidden="true" />
                    <span className="process-label">{label}</span>
                  </li>
                ),
              )}
            </ol>
          </div>
          <p className="process-note">
            A clearer path from the details you have to the questions worth
            asking.
            <br />
            <span>Analysis is in development. Explore the preview today</span>
          </p>
        </section>
        <section
          className="landing-showcase landing-editorial"
          aria-labelledby="showcase-title"
        >
          <div className="landing-container editorial-grid">
            <figure className="editorial-art property-art">
              <img
                src={property}
                width="1536"
                height="1024"
                alt=""
                loading="lazy"
                decoding="async"
              />
            </figure>
            <div className="editorial-copy">
              <h2 id="showcase-title">
                See what others
                <br />
                <span className="orange">might miss</span>
              </h2>
              <p className="landing-copy">
                Compare key details across rental evidence, spot
                inconsistencies, and understand which questions to ask before
                paying.
              </p>
              <button
                className="landing-button landing-button-outline"
                onClick={() => report.current?.showModal()}
              >
                See an example report{' '}
                <ArrowRight size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>
        <section
          id="why-it-matters"
          className="landing-why landing-editorial"
          aria-labelledby="why-title"
        >
          <div className="landing-container editorial-grid">
            <div className="editorial-copy">
              <p className="editorial-eyebrow">WHY IT MATTERS</p>
              <h2 id="why-title">
                A safer rental
                <br />
                journey <span className="orange">for everyone</span>
              </h2>
              <p className="landing-copy">
                Finding a place to live should be exciting, not stressful.
                Sniffo helps you examine the details, understand warning signs,
                and make more informed decisions.
              </p>
            </div>
            <div className="editorial-art window-art">
              <img
                src={windowArt}
                width="1536"
                height="1024"
                alt=""
                loading="lazy"
                decoding="async"
              />
            </div>
          </div>
        </section>
        <section
          className="landing-reassurance"
          aria-labelledby="reassurance-title"
        >
          <h2 id="reassurance-title">
            Your next home deserves
            <br />
            <span className="orange">a closer look</span>
          </h2>
          <p className="landing-copy">
            Understand the evidence. Ask better questions. Take your time.
          </p>
        </section>
        <section className="landing-final" aria-labelledby="final-title">
          <img
            className="landing-final-art"
            src={footer}
            width="1536"
            height="1024"
            alt=""
            loading="lazy"
            decoding="async"
          />
          <div className="landing-container final-content">
            <h2 id="final-title">
              <span className="hero-line">
                <span>Start your safer </span>
              </span>
              <span className="hero-line">
                <span>
                  rental journey <span className="orange">today</span>
                </span>
              </span>
            </h2>
            <p className="landing-copy">
              Review a listing, understand the evidence, and take the next step
              with more confidence.
            </p>
            <ListingUrlEntry />
          </div>
        </section>
        <section id="faq" className="landing-faq" aria-labelledby="faq-title">
          <div className="faq-grid landing-container">
            <h2 id="faq-title">Before you get started</h2>
            <div className="faq-list">
              <details>
                <summary>
                  Can I run a property check today?
                  <span className="faq-toggle" aria-hidden="true" />
                </summary>
                <p>
                  Not yet. The check flow is a preview while the verification
                  service is being built. You can paste a listing URL and carry
                  it into the check form, or explore the fictional example
                  report.
                </p>
              </details>
              <details>
                <summary>
                  Does Sniffo guarantee a rental is safe?
                  <span className="faq-toggle" aria-hidden="true" />
                </summary>
                <p>
                  No. Warning signs and consistent details cannot prove that a
                  rental is safe. Confirm important claims independently before
                  signing an agreement or sending money.
                </p>
              </details>
              <details>
                <summary>
                  What evidence will I be able to review?
                  <span className="faq-toggle" aria-hidden="true" />
                </summary>
                <p>
                  The planned flow brings together rental listing details,
                  landlord conversations, and agreements. Conversation
                  screenshots and document uploads are not available in the
                  current preview.
                </p>
              </details>
            </div>
          </div>
        </section>
      </main>
      <footer className="landing-footer landing-container">
        <SniffoBrand />
        <nav aria-label="Footer navigation">
          <Link to="/#how-it-works">How It Works</Link>
          <Link to="/#why-it-matters">Why It Matters</Link>
          <Link to="/#faq">FAQ</Link>
        </nav>
        <span>A clearer view before you make a move.</span>
      </footer>
      <dialog
        ref={report}
        className="sample-report"
        aria-labelledby="sample-title"
        aria-describedby="sample-description"
      >
        <button
          className="sample-close"
          aria-label="Close example report"
          onClick={() => report.current?.close()}
        >
          <X size={22} />
        </button>
        <h2 id="sample-title">A closer look at the details</h2>
        <p className="sample-kicker">Fictional example · Not a live check</p>
        <p id="sample-description">
          This sample shows how findings could explain inconsistencies. No
          property, person, or public record has been verified.
        </p>
        <h3>Example listing: Garden Apartment</h3>
        <dl>
          <div>
            <dt>Deposit amount differs</dt>
            <dd>
              The listing says one month’s deposit; the example message asks for
              two. Ask for the full payment terms in writing.
            </dd>
          </div>
          <div>
            <dt>Viewing before payment</dt>
            <dd>
              The example message requests a transfer before a viewing. Arrange
              a viewing and independently confirm the recipient’s authority
              before paying.
            </dd>
          </div>
          <div>
            <dt>More evidence needed</dt>
            <dd>
              The example agreement omits the unit number. Request the full
              address and check that it matches the listing.
            </dd>
          </div>
        </dl>
        <Link to="/results?sample=1" className="text-link">
          Explore the full sample report{' '}
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
        <p className="sample-note">
          An inconsistency is a reason to investigate, not proof of fraud. Live
          analysis is still in development.
        </p>
        <button
          className="landing-button landing-button-outline"
          onClick={() => report.current?.close()}
        >
          Back to Sniffo <ArrowRight size={18} />
        </button>
      </dialog>
    </div>
  );
}
