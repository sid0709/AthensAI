import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { AppLogo } from "../../components/shared/AppLogo";
import { display } from "../../lib/utils";
import { PATHS } from "../../config/routes";
import { LANDING_TITLE } from "../../seo/site";
import { LANDING_CHAPTERS, LANDING_MODULES } from "./landingContent";
import "./landing.css";

const hero = LANDING_CHAPTERS[0];
const finale = LANDING_CHAPTERS.at(-1);

export function LandingPage() {
  if (!hero || !finale) return null;
  return (
    <div className="landing">
      <div className="landing-sky" aria-hidden="true">
        <div className="landing-grain" />
        <div className="landing-grid" />
      </div>

      <a className="landing-skip" href="#landing-main">
        Skip to content
      </a>

      <header className="landing-header">
        <Link to={PATHS.home} className="landing-brand" aria-label={LANDING_TITLE}>
          <AppLogo size={36} />
          <span style={display}>
            ATHENS<span>AI</span>
          </span>
        </Link>
        <nav className="landing-nav" aria-label="Account">
          <Link to={PATHS.signin} className="landing-nav-link">
            Sign in
          </Link>
          <Link to={PATHS.signup} className="landing-nav-cta">
            Create account
          </Link>
        </nav>
      </header>

      <main id="landing-main" className="landing-main">
        <section className="landing-hero" aria-labelledby="landing-hero-title">
          <p className="landing-kicker">{hero.code}</p>
          <h1 id="landing-hero-title" style={display}>
            {hero.title}
          </h1>
          <p className="landing-lede">
            {hero.body} Chart the stars, choose a route, and move with direction instead of guesswork.
          </p>
          <div className="landing-actions">
            <Link to={PATHS.signup} className="landing-btn-primary">
              Enter the galaxy
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link to={PATHS.signin} className="landing-btn-ghost">
              Sign in
            </Link>
          </div>
        </section>

        <section className="landing-section" aria-labelledby="landing-journey-title">
          <p className="landing-kicker">NAVIGATION / 02</p>
          <h2 id="landing-journey-title" style={display}>
            How the sky becomes a route.
          </h2>
          <ol className="landing-chapters">
            {LANDING_CHAPTERS.map((chapter) => (
              <li key={chapter.code}>
                <p className="landing-chapter-code">{chapter.code}</p>
                <h3 style={display}>{chapter.title}</h3>
                <p>{chapter.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-section" aria-labelledby="landing-workspace-title">
          <p className="landing-kicker">WORKSPACE / 03</p>
          <h2 id="landing-workspace-title" style={display}>
            Everything you need to chase the next star.
          </h2>
          <ul className="landing-modules">
            {LANDING_MODULES.map((module) => (
              <li key={module.title}>
                <h3 style={display}>{module.title}</h3>
                <p>{module.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="landing-final" aria-labelledby="landing-final-title">
          <p className="landing-kicker">{finale.code}</p>
          <h2 id="landing-final-title" style={display}>
            {finale.title}
          </h2>
          <p>
            {finale.body}
          </p>
          <div className="landing-actions">
            <Link to={PATHS.signup} className="landing-btn-primary">
              Create your account
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link to={PATHS.signin} className="landing-btn-ghost">
              I already have access
            </Link>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <p>AthensAI · Career navigation</p>
        <nav aria-label="Footer">
          <Link to={PATHS.signin}>Sign in</Link>
          <Link to={PATHS.signup}>Create account</Link>
        </nav>
      </footer>
    </div>
  );
}
