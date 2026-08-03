import { useRef, useState } from "react";
import { ArrowDown, VolumeX } from "lucide-react";
import { display } from "../../../lib/utils";
import { AuthSceneCanvas } from "./AuthSceneCanvas";
import { nextAuthScene } from "./authScene";

const SCENES = [
  {
    code: "SIGNAL / 01",
    title: "Turn your career into signal.",
    body: "Athens reads the market around you—connecting your experience, live roles, and the skills that move both.",
    metric: "LIVE ROLE GRAPH",
    value: "01,248",
  },
  {
    code: "MATCH / 02",
    title: "See the right path before you move.",
    body: "Every opportunity is ranked against your real profile, with the gaps and strongest connections made visible.",
    metric: "MATCH VECTORS",
    value: "∞ / LIVE",
  },
  {
    code: "MOMENTUM / 03",
    title: "Move from insight to offer.",
    body: "Build precise résumés, run applications, and learn from every response in one intelligent command center.",
    metric: "CAREER SYSTEM",
    value: "ONLINE",
  },
];

export function AuthHeroPanel() {
  const [scene, setScene] = useState(0);
  const lastWheelAt = useRef(0);
  const activeScene = SCENES[scene];

  const onWheel = (event: React.WheelEvent<HTMLElement>) => {
    if (Math.abs(event.deltaY) < 18 || Date.now() - lastWheelAt.current < 520) return;
    lastWheelAt.current = Date.now();
    setScene((current) => nextAuthScene(current, event.deltaY, SCENES.length));
  };

  return (
    <section className="auth-hero" onWheel={onWheel} aria-label="AthensAI career intelligence preview">
      <AuthSceneCanvas scene={scene} />
      <div className="auth-hero-grain" aria-hidden="true" />
      <div className="auth-hero-grid" aria-hidden="true" />

      <header className="auth-world-header">
        <div className="auth-wordmark" style={display}>
          ATHENS<span>AI</span>
        </div>
        <div className="auth-coordinate" aria-hidden="true">
          NODE 37.9838° N<br />23.7275° E
        </div>
      </header>

      <div className="auth-scene-readout" aria-live="polite">
        <p className="auth-kicker">////// {activeScene.code}</p>
        <h1 key={`title-${scene}`} style={display}>
          {activeScene.title}
        </h1>
        <p key={`body-${scene}`} className="auth-scene-body">
          {activeScene.body}
        </p>
      </div>

      <div className="auth-orbit-metric" aria-hidden="true">
        <span>{activeScene.metric}</span>
        <strong>{activeScene.value}</strong>
      </div>

      <footer className="auth-world-footer">
        <div className="auth-scroll-hint">
          <ArrowDown size={14} />
          <span>Scroll to explore</span>
        </div>
        <div className="auth-scene-dots" aria-label="Preview scenes">
          {SCENES.map((item, index) => (
            <button
              key={item.code}
              type="button"
              className={index === scene ? "is-active" : ""}
              onClick={() => setScene(index)}
              aria-label={`Show scene ${index + 1}: ${item.title}`}
              aria-current={index === scene ? "step" : undefined}
            />
          ))}
        </div>
        <div className="auth-sound-label" aria-hidden="true">
          <VolumeX size={14} /> Sound off
        </div>
      </footer>
    </section>
  );
}
