import { useEffect, useRef } from "react";
import { createSignalPoints } from "./authScene";
import {
  IGNITION_MS,
  TRAVEL_MS,
  type AuthExperiencePhase,
} from "../experience/authExperienceState";

type AuthSceneCanvasProps = {
  scene: number;
  phase: AuthExperiencePhase;
  phaseStartedAt: number;
  introDurationMs: number;
  reducedMotion: boolean;
  onUnavailable?: () => void;
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const easeOutCubic = (value: number) => 1 - Math.pow(1 - clamp(value), 3);
const mix = (start: number, end: number, progress: number) => start + (end - start) * progress;

export function AuthSceneCanvas({
  scene,
  phase,
  phaseStartedAt,
  introDurationMs,
  reducedMotion,
  onUnavailable,
}: AuthSceneCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ scene, phase, phaseStartedAt, introDurationMs, reducedMotion });

  useEffect(() => {
    stateRef.current = { scene, phase, phaseStartedAt, introDurationMs, reducedMotion };
  }, [introDurationMs, phase, phaseStartedAt, reducedMotion, scene]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) {
      onUnavailable?.();
      return;
    }

    const points = createSignalPoints();
    const pointer = { x: 0, y: 0 };
    let width = 0;
    let height = 0;
    let animationFrame = 0;
    let renderedScene = stateRef.current.scene;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * ratio));
      canvas.height = Math.max(1, Math.floor(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const onPointerMove = (event: PointerEvent) => {
      pointer.x = (event.clientX / Math.max(width, 1) - 0.5) * 2;
      pointer.y = (event.clientY / Math.max(height, 1) - 0.5) * 2;
    };

    const drawTrails = (
      centerX: number,
      centerY: number,
      radius: number,
      progress: number,
      travelProgress: number,
    ) => {
      const targets = [
        { x: width * 0.2, y: height * 0.25, selected: false },
        { x: width * 0.28, y: height * 0.76, selected: false },
        { x: width * 0.63, y: height * 0.77, selected: false },
        { x: width * 0.82, y: height * 0.38, selected: true },
      ];
      for (const [index, target] of targets.entries()) {
        const selectedBoost = target.selected ? 1 : 0.48;
        const endX = mix(centerX, target.x, progress);
        const endY = mix(centerY, target.y, progress);
        context.beginPath();
        context.moveTo(centerX, centerY);
        context.quadraticCurveTo(
          mix(centerX, target.x, 0.52),
          centerY + (index - 1.5) * radius * 0.3,
          endX,
          endY,
        );
        context.setLineDash(target.selected ? [] : [3, 9]);
        context.strokeStyle = target.selected
          ? `rgba(229, 224, 255, ${0.78 * progress})`
          : `rgba(173, 161, 231, ${0.36 * progress})`;
        context.lineWidth = (target.selected ? 2.1 : 0.8) + travelProgress * selectedBoost;
        context.stroke();

        context.beginPath();
        context.arc(endX, endY, (target.selected ? 4.5 : 2.4) * progress, 0, Math.PI * 2);
        context.fillStyle = target.selected
          ? `rgba(246, 243, 255, ${progress})`
          : `rgba(186, 176, 235, ${0.62 * progress})`;
        context.fill();
      }
      context.setLineDash([]);
    };

    const drawCareerRoute = (
      centerX: number,
      centerY: number,
      radius: number,
      sceneProgress: number,
      now: number,
    ) => {
      const navigationProgress = easeOutCubic(clamp((sceneProgress - 2.15) / 0.85));
      if (navigationProgress <= 0) return;

      const selectionProgress = easeOutCubic(clamp((sceneProgress - 3.35) / 0.95));
      const conquestProgress = easeOutCubic(clamp((sceneProgress - 4.3) / 0.7));
      const targetX = centerX + radius * (width < 800 ? 0.76 : 0.72);
      const targetY = centerY - radius * 0.45;
      const controlX = centerX + radius * 0.38;
      const controlY = centerY - radius * 0.55;
      const pointOnRoute = (progress: number) => {
        const inverse = 1 - progress;
        return {
          x: inverse * inverse * centerX + 2 * inverse * progress * controlX + progress * progress * targetX,
          y: inverse * inverse * centerY + 2 * inverse * progress * controlY + progress * progress * targetY,
        };
      };

      context.save();

      const alternateOpacity = navigationProgress * (1 - selectionProgress * 0.72);
      const alternateTargets = [
        { x: centerX + radius * 0.72, y: centerY - radius * 0.94, bend: -0.32 },
        { x: centerX + radius * 1.05, y: centerY + radius * 0.37, bend: 0.42 },
      ];
      alternateTargets.forEach((target) => {
        context.beginPath();
        context.moveTo(centerX, centerY);
        context.quadraticCurveTo(
          centerX + radius * 0.44,
          centerY + radius * target.bend,
          mix(centerX, target.x, navigationProgress),
          mix(centerY, target.y, navigationProgress),
        );
        context.setLineDash([2, 9]);
        context.strokeStyle = `rgba(167, 155, 225, ${alternateOpacity * 0.3})`;
        context.lineWidth = 0.7;
        context.stroke();
      });
      context.setLineDash([]);

      context.beginPath();
      for (let step = 0; step <= 42; step += 1) {
        const progress = (step / 42) * navigationProgress;
        const point = pointOnRoute(progress);
        if (step === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      }
      context.strokeStyle = `rgba(220, 213, 255, ${0.34 + selectionProgress * 0.48})`;
      context.lineWidth = 0.9 + selectionProgress * 1.45;
      context.shadowColor = "rgba(157, 137, 255, 0.7)";
      context.shadowBlur = selectionProgress * 12;
      context.stroke();
      context.shadowBlur = 0;

      [0.28, 0.54, 0.78].forEach((markerProgress, index) => {
        if (navigationProgress < markerProgress) return;
        const point = pointOnRoute(markerProgress);
        const markerReveal = clamp((navigationProgress - markerProgress) * 5);
        context.beginPath();
        context.arc(point.x, point.y, 1.5 + selectionProgress * 0.65, 0, Math.PI * 2);
        context.fillStyle = `rgba(235, 231, 255, ${markerReveal * (0.55 + index * 0.1)})`;
        context.fill();
      });

      const targetReveal = clamp((navigationProgress - 0.72) * 3.6);
      const pulse = 0.86 + Math.sin(now * 0.0034) * 0.14;
      const haloRadius = radius * (0.11 + conquestProgress * 0.055) * pulse;
      const targetHalo = context.createRadialGradient(targetX, targetY, 0, targetX, targetY, haloRadius);
      targetHalo.addColorStop(0, `rgba(252, 250, 255, ${targetReveal * 0.86})`);
      targetHalo.addColorStop(0.14, `rgba(197, 187, 255, ${targetReveal * 0.58})`);
      targetHalo.addColorStop(1, "rgba(128, 102, 255, 0)");
      context.fillStyle = targetHalo;
      context.beginPath();
      context.arc(targetX, targetY, haloRadius, 0, Math.PI * 2);
      context.fill();

      context.beginPath();
      context.arc(targetX, targetY, 3.2 + selectionProgress * 2.2 + conquestProgress * 1.5, 0, Math.PI * 2);
      context.fillStyle = `rgba(252, 251, 255, ${targetReveal})`;
      context.fill();

      if (conquestProgress > 0) {
        context.strokeStyle = `rgba(225, 219, 255, ${conquestProgress * 0.7})`;
        context.lineWidth = 0.8;
        context.setLineDash([7, 7]);
        context.beginPath();
        context.arc(targetX, targetY, 13 + conquestProgress * 8, 0, Math.PI * 2);
        context.stroke();
        context.setLineDash([]);

        for (let ray = 0; ray < 4; ray += 1) {
          const angle = ray * Math.PI * 0.5 + now * 0.0002;
          const innerRadius = 25;
          const outerRadius = 33 + conquestProgress * 5;
          context.beginPath();
          context.moveTo(targetX + Math.cos(angle) * innerRadius, targetY + Math.sin(angle) * innerRadius);
          context.lineTo(targetX + Math.cos(angle) * outerRadius, targetY + Math.sin(angle) * outerRadius);
          context.strokeStyle = `rgba(215, 207, 255, ${conquestProgress * 0.48})`;
          context.stroke();
        }
      }

      context.restore();
    };

    const drawOrbital = () => {
      try {
        const now = Date.now();
        const current = stateRef.current;
        const elapsed = now - current.phaseStartedAt;
        renderedScene += (current.scene - renderedScene) * 0.045;

        const compact = width < 800;
        const mobilePointCount = compact ? 40 : points.length;
        const introProgress = current.phase === "intro"
          ? clamp(elapsed / Math.max(current.introDurationMs, 1))
          : 1;
        const convergence = current.phase === "intro"
          ? easeOutCubic((introProgress - 0.14) / 0.5)
          : 1;
        const ignitionProgress = current.phase === "ignition" ? clamp(elapsed / IGNITION_MS) : 0;
        const travelProgress = current.phase === "travel"
          ? clamp(elapsed / TRAVEL_MS)
          : current.phase === "reveal" ? 1 : 0;
        const successProgress = current.phase === "ignition"
          ? ignitionProgress * 0.12
          : current.phase === "travel" || current.phase === "reveal" ? 1 : 0;

        const authCenterX = compact ? width * 0.5 : width * 0.38;
        const centerX = mix(authCenterX, width * 0.5, successProgress);
        const centerY = mix(compact ? height * 0.36 : height * 0.5, height * 0.48, successProgress);
        const baseRadius = Math.min(width * (compact ? 0.29 : 0.22), height * 0.34);
        const radius = baseRadius * (1 + renderedScene * 0.055);
        const timeRotation = current.reducedMotion ? 0.35 : now * 0.00011;
        const rotation = timeRotation + renderedScene * 0.72 + pointer.x * 0.08;
        const tilt = -0.22 + pointer.y * 0.055 + renderedScene * 0.035;
        const travelScale = 1 + easeOutCubic(travelProgress) * 2.8;

        context.clearRect(0, 0, width, height);

        const ambient = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius * 2.4);
        ambient.addColorStop(0, `rgba(185, 174, 255, ${0.17 + ignitionProgress * 0.35})`);
        ambient.addColorStop(0.34, "rgba(118, 100, 236, 0.08)");
        ambient.addColorStop(1, "rgba(8, 8, 18, 0)");
        context.fillStyle = ambient;
        context.fillRect(0, 0, width, height);

        if (convergence > 0.25 && travelProgress < 0.94) {
          context.save();
          context.globalAlpha = clamp((convergence - 0.25) / 0.75) * (1 - travelProgress * 0.55);
          context.translate(centerX, centerY);
          context.rotate(-0.18 + renderedScene * 0.16);
          for (let ring = 0; ring < 4; ring += 1) {
            context.beginPath();
            context.ellipse(
              0,
              0,
              radius * (0.72 + ring * 0.18) * travelScale,
              radius * (0.21 + ring * 0.035) * travelScale,
              0,
              0,
              Math.PI * 2,
            );
            context.strokeStyle = `rgba(210, 205, 255, ${0.23 - ring * 0.035})`;
            context.lineWidth = ring === 0 ? 1.2 : 0.7;
            context.setLineDash(ring % 2 ? [3, 9] : []);
            context.stroke();
          }
          context.restore();
          context.setLineDash([]);
        }

        const projected = points.slice(0, mobilePointCount).map((point) => {
          const longitude = point.longitude + rotation + Math.sin(renderedScene * 0.9 + point.pulse) * 0.05;
          const sphereX = Math.sin(point.latitude) * Math.cos(longitude);
          const rawY = Math.cos(point.latitude);
          const rawZ = Math.sin(point.latitude) * Math.sin(longitude);
          const sphereY = rawY * Math.cos(tilt) - rawZ * Math.sin(tilt);
          const sphereZ = rawY * Math.sin(tilt) + rawZ * Math.cos(tilt);
          const depth = (sphereZ + 1) / 2;
          const expansion = (1 + Math.sin(renderedScene * 1.3 + point.pulse) * renderedScene * 0.06) * travelScale;
          const finalX = centerX + sphereX * radius * expansion;
          const finalY = centerY + sphereY * radius * expansion;
          const scatteredX = width * (0.5 + point.scatterX * 0.68) + Math.sin(now * 0.0003 + point.pulse) * 12;
          const scatteredY = height * (0.5 + point.scatterY * 0.68) + Math.cos(now * 0.00025 + point.pulse) * 9;
          return {
            x: mix(scatteredX, finalX, convergence),
            y: mix(scatteredY, finalY, convergence),
            finalX,
            finalY,
            z: sphereZ,
            depth,
            size: point.size,
            pulse: point.pulse,
          };
        });

        if (convergence > 0.22 && travelProgress < 0.82) {
          const constellationStrength = 0.55 + easeOutCubic(clamp((renderedScene - 1.15) / 1.15)) * 0.95;
          for (let first = 0; first < projected.length; first += 1) {
            for (let second = first + 1; second < projected.length; second += 1) {
              const a = projected[first];
              const b = projected[second];
              const distance = Math.hypot(a.x - b.x, a.y - b.y);
              if (distance > radius * 0.34 || a.z < -0.48 || b.z < -0.48) continue;
              const alpha = (1 - distance / (radius * 0.34)) * 0.22 * Math.min(a.depth, b.depth) * convergence * constellationStrength;
              context.beginPath();
              context.moveTo(a.x, a.y);
              context.lineTo(b.x, b.y);
              context.strokeStyle = `rgba(190, 181, 255, ${alpha})`;
              context.lineWidth = 0.65;
              context.stroke();
            }
          }
        }

        projected
          .sort((a, b) => a.z - b.z)
          .forEach((point, index) => {
            const pulse = 0.78 + Math.sin(now * 0.0016 + point.pulse) * 0.22;
            const starAwareness = 1 + easeOutCubic(clamp(renderedScene / 1.1)) * 0.16;
            const pointRadius = point.size * (0.55 + point.depth * 0.75) * pulse * starAwareness;
            if (travelProgress > 0.04) {
              context.beginPath();
              context.moveTo(point.x, point.y);
              context.lineTo(
                mix(centerX, point.x, 1 + travelProgress * 0.18),
                mix(centerY, point.y, 1 + travelProgress * 0.18),
              );
              context.strokeStyle = `rgba(205, 198, 255, ${travelProgress * 0.28})`;
              context.lineWidth = Math.max(0.5, pointRadius * 0.45);
              context.stroke();
            }
            const haloInterval = renderedScene > 0.65 ? 7 : 11;
            if (index % haloInterval === 0 && point.z > -0.15) {
              const halo = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, pointRadius * 9);
              halo.addColorStop(0, "rgba(235, 231, 255, 0.35)");
              halo.addColorStop(1, "rgba(145, 125, 255, 0)");
              context.fillStyle = halo;
              context.beginPath();
              context.arc(point.x, point.y, pointRadius * 9, 0, Math.PI * 2);
              context.fill();
            }
            context.beginPath();
            context.arc(point.x, point.y, pointRadius, 0, Math.PI * 2);
            context.fillStyle = point.z > 0 ? "rgba(241, 239, 255, 0.96)" : "rgba(142, 132, 203, 0.42)";
            context.fill();
          });

        const isPathfinding = current.phase === "ignition" || current.phase === "travel" || current.phase === "reveal";
        if (!isPathfinding) {
          drawCareerRoute(centerX, centerY, radius, renderedScene, now);
        }
        if (isPathfinding) {
          const trailProgress = current.phase === "ignition" ? easeOutCubic(ignitionProgress) : 1;
          drawTrails(centerX, centerY, radius, trailProgress, travelProgress);
        }

        if (current.phase === "authenticating" || current.phase === "failure") {
          const sourceX = compact ? width * 0.79 : width * 0.68;
          const sourceY = compact ? height * 0.6 : height * 0.5;
          const breathing = 0.45 + Math.sin(now * 0.004) * 0.25;
          const reversing = current.phase === "failure" ? clamp(elapsed / 350) : 0;
          context.beginPath();
          context.moveTo(mix(sourceX, centerX, reversing), mix(sourceY, centerY, reversing));
          context.lineTo(centerX, centerY);
          context.strokeStyle = current.phase === "failure"
            ? `rgba(248, 163, 184, ${0.52 * (1 - reversing)})`
            : `rgba(205, 195, 255, ${breathing})`;
          context.lineWidth = 1.2;
          context.setLineDash([3, 8]);
          context.stroke();
          context.setLineDash([]);
          if (current.phase === "authenticating") {
            const signal = (now * 0.00065) % 1;
            context.beginPath();
            context.arc(mix(sourceX, centerX, signal), mix(sourceY, centerY, signal), 2.4, 0, Math.PI * 2);
            context.fillStyle = "rgba(247, 244, 255, 0.95)";
            context.fill();
          }
        }

        if (convergence > 0.42) {
          context.save();
          context.translate(centerX, centerY);
          context.rotate(rotation * 0.22);
          const coreRadius = radius * (0.42 + ignitionProgress * 0.16);
          const core = context.createRadialGradient(-radius * 0.08, -radius * 0.1, 0, 0, 0, coreRadius);
          core.addColorStop(0, `rgba(255, 254, 255, ${0.9 + ignitionProgress * 0.1})`);
          core.addColorStop(0.18, `rgba(176, 159, 255, ${0.62 + ignitionProgress * 0.28})`);
          core.addColorStop(0.52, "rgba(104, 83, 218, 0.16)");
          core.addColorStop(1, "rgba(74, 57, 160, 0)");
          context.fillStyle = core;
          context.beginPath();
          context.arc(0, 0, coreRadius, 0, Math.PI * 2);
          context.fill();
          context.restore();
        }
      } catch {
        onUnavailable?.();
        return;
      }

      animationFrame = window.requestAnimationFrame(drawOrbital);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    drawOrbital();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, [onUnavailable]);

  return <canvas ref={canvasRef} className="auth-scene-canvas" aria-hidden="true" />;
}
