import { useCallback, useState, type CSSProperties } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { AuthSceneCanvas } from "../components/AuthSceneCanvas";
import { useAuthExperience } from "./AuthExperienceContext";
import { isSuccessPhase } from "./authExperienceState";
import "../components/auth.css";

const ROUTES = [
  { id: "profile", label: "Profile" },
  { id: "jobs", label: "Jobs" },
  { id: "applications", label: "Applications" },
  { id: "workspace", label: "Workspace", selected: true },
];

export function AuthExperienceLayer() {
  const experience = useAuthExperience();
  const [canvasUnavailable, setCanvasUnavailable] = useState(false);
  const markCanvasUnavailable = useCallback(() => setCanvasUnavailable(true), []);

  if (!experience.layerVisible) return null;

  const successPhase = isSuccessPhase(experience.phase);
  const blocking = experience.introActive || successPhase;
  const status = experience.phase === "intro"
    ? "Synchronizing career signals"
    : experience.phase === "authenticating"
      ? "Mapping your signal"
      : experience.phase === "failure"
        ? "Signal not confirmed"
        : experience.phase === "ignition"
          ? experience.accountName ? `Welcome, ${experience.accountName}` : "Path confirmed"
          : experience.phase === "travel"
            ? "Workspace route confirmed"
            : experience.phase === "reveal"
              ? "Opening your workspace"
              : "Career signal field active";

  return (
    <div
      className={`auth-experience-layer auth-experience-${experience.phase} auth-intro-${experience.introVariant} ${blocking ? "is-blocking" : "is-background"} ${canvasUnavailable ? "is-canvas-fallback" : ""}`}
      style={{ "--auth-intro-duration": `${experience.introDurationMs}ms` } as CSSProperties}
      data-auth-phase={experience.phase}
      aria-hidden={blocking ? undefined : true}
    >
      {!canvasUnavailable ? (
        <AuthSceneCanvas
          scene={experience.scene}
          phase={experience.phase}
          phaseStartedAt={experience.phaseStartedAt}
          introDurationMs={experience.introDurationMs}
          reducedMotion={experience.reducedMotion}
          onUnavailable={markCanvasUnavailable}
        />
      ) : null}

      {experience.phase === "intro" ? (
        <div className="auth-intro-lockup" aria-hidden="true">
          <div className="auth-intro-signal" />
          <p>INITIALIZING CAREER MAP</p>
          <div className="auth-intro-wordmark">
            <span>ATHENS</span><em>AI</em>
          </div>
          <div className="auth-intro-thread auth-intro-thread-a" />
          <div className="auth-intro-thread auth-intro-thread-b" />
        </div>
      ) : null}

      {successPhase ? (
        <>
          <div className="auth-transition-identity">
            <span>IDENTITY CONFIRMED</span>
            <strong>{experience.accountName ? `Welcome, ${experience.accountName}.` : "Path confirmed."}</strong>
          </div>

          <div className="auth-route-labels" aria-label="Workspace route selection">
            {ROUTES.map((route) => (
              <div
                key={route.id}
                className={`auth-route-label auth-route-${route.id} ${route.selected ? "is-selected" : ""}`}
              >
                <span>{route.selected ? "04" : `0${ROUTES.indexOf(route) + 1}`}</span>
                {route.label}
              </div>
            ))}
          </div>

          <div className="auth-dashboard-blueprint" aria-hidden="true">
            <div className="auth-blueprint-sidebar">
              <i /><i /><i /><i /><i />
            </div>
            <div className="auth-blueprint-topbar" />
            <div className="auth-blueprint-content">
              <div className="auth-blueprint-hero"><span /></div>
              <div className="auth-blueprint-cards"><i /><i /><i /><i /></div>
            </div>
          </div>

          {experience.offline ? (
            <p className="auth-offline-status">OFFLINE · PROFILE SYNC PENDING</p>
          ) : null}
        </>
      ) : null}

      {(experience.phase === "intro" || successPhase) ? (
        <button
          type="button"
          className="auth-experience-skip"
          onClick={experience.skip}
          data-auth-silent-action
        >
          Skip <span>ESC</span>
        </button>
      ) : null}

      {experience.phase === "intro" ? (
        <button
          type="button"
          className="auth-experience-sound"
          onClick={experience.toggleSound}
          data-auth-silent-action
          aria-pressed={experience.soundEnabled}
        >
          {experience.soundEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
          Sound {experience.soundEnabled ? "on" : "off"}
        </button>
      ) : null}

      <p className="sr-only" aria-live="polite" aria-atomic="true">{status}</p>
    </div>
  );
}
