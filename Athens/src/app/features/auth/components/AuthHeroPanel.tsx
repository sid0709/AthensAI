import { useRef, useState } from "react";
import { ArrowDown, Volume2, VolumeX } from "lucide-react";
import { display } from "../../../lib/utils";
import { nextAuthScene } from "./authScene";
import { useAuthExperience } from "../experience/AuthExperienceContext";
import { AUTH_NARRATIVE_SCENES } from "./authNarrative";

export function AuthHeroPanel() {
  const experience = useAuthExperience();
  const [scene, setLocalScene] = useState(experience.scene);
  const lastWheelAt = useRef(0);
  const activeScene = AUTH_NARRATIVE_SCENES[scene];

  const setScene = (nextScene: number) => {
    setLocalScene(nextScene);
    experience.setScene(nextScene);
  };

  const onWheel = (event: React.WheelEvent<HTMLElement>) => {
    if (Math.abs(event.deltaY) < 18 || Date.now() - lastWheelAt.current < 520) return;
    lastWheelAt.current = Date.now();
    experience.registerInteraction();
    setScene(nextAuthScene(scene, event.deltaY, AUTH_NARRATIVE_SCENES.length));
  };

  return (
    <section className="auth-hero" onWheel={onWheel} aria-label="AthensAI career galaxy journey">
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
          <span>Scroll the galaxy</span>
        </div>
        <div className="auth-scene-dots" aria-label="Galaxy chapters">
          {AUTH_NARRATIVE_SCENES.map((item, index) => (
            <button
              key={item.code}
              type="button"
              className={index === scene ? "is-active" : index < scene ? "is-passed" : ""}
              onClick={() => {
                experience.registerInteraction();
                setScene(index);
              }}
              aria-label={`Show scene ${index + 1}: ${item.title}`}
              aria-current={index === scene ? "step" : undefined}
            />
          ))}
        </div>
        <button
          type="button"
          className="auth-sound-label"
          onClick={experience.toggleSound}
          data-auth-silent-action
          aria-pressed={experience.soundEnabled}
        >
          {experience.soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
          Sound {experience.soundEnabled ? "on" : "off"}
        </button>
      </footer>
    </section>
  );
}
