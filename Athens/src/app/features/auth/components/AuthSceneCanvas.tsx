import { useEffect, useRef } from "react";
import { createSignalPoints } from "./authScene";

type AuthSceneCanvasProps = {
  scene: number;
};

export function AuthSceneCanvas({ scene }: AuthSceneCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef(scene);

  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const points = createSignalPoints();
    const pointer = { x: 0, y: 0 };
    let width = 0;
    let height = 0;
    let animationFrame = 0;
    let renderedScene = sceneRef.current;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

    const drawOrbital = (time: number) => {
      renderedScene += (sceneRef.current - renderedScene) * 0.045;
      const compact = width < 800;
      const centerX = compact ? width * 0.5 : width * 0.38;
      const centerY = compact ? height * 0.36 : height * 0.5;
      const baseRadius = Math.min(width * (compact ? 0.29 : 0.22), height * 0.34);
      const radius = baseRadius * (1 + renderedScene * 0.055);
      const rotation = (reduceMotion ? 0.35 : time * 0.00011) + renderedScene * 0.72 + pointer.x * 0.08;
      const tilt = -0.22 + pointer.y * 0.055 + renderedScene * 0.035;

      context.clearRect(0, 0, width, height);

      const ambient = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius * 2.2);
      ambient.addColorStop(0, `rgba(185, 174, 255, ${0.18 + renderedScene * 0.02})`);
      ambient.addColorStop(0.35, "rgba(118, 100, 236, 0.08)");
      ambient.addColorStop(1, "rgba(8, 8, 18, 0)");
      context.fillStyle = ambient;
      context.fillRect(0, 0, width, height);

      context.save();
      context.translate(centerX, centerY);
      context.rotate(-0.18 + renderedScene * 0.16);
      for (let ring = 0; ring < 4; ring += 1) {
        context.beginPath();
        context.ellipse(0, 0, radius * (0.72 + ring * 0.18), radius * (0.21 + ring * 0.035), 0, 0, Math.PI * 2);
        context.strokeStyle = `rgba(210, 205, 255, ${0.23 - ring * 0.035})`;
        context.lineWidth = ring === 0 ? 1.2 : 0.7;
        context.setLineDash(ring % 2 ? [3, 9] : [1, 0]);
        context.stroke();
      }
      context.restore();
      context.setLineDash([]);

      const projected = points.map((point) => {
        const longitude = point.longitude + rotation + Math.sin(renderedScene * 0.9 + point.pulse) * 0.05;
        const sphereX = Math.sin(point.latitude) * Math.cos(longitude);
        const rawY = Math.cos(point.latitude);
        const rawZ = Math.sin(point.latitude) * Math.sin(longitude);
        const sphereY = rawY * Math.cos(tilt) - rawZ * Math.sin(tilt);
        const sphereZ = rawY * Math.sin(tilt) + rawZ * Math.cos(tilt);
        const depth = (sphereZ + 1) / 2;
        const expansion = 1 + Math.sin(renderedScene * 1.3 + point.pulse) * renderedScene * 0.06;
        return {
          x: centerX + sphereX * radius * expansion,
          y: centerY + sphereY * radius * expansion,
          z: sphereZ,
          depth,
          size: point.size,
          pulse: point.pulse,
        };
      });

      for (let first = 0; first < projected.length; first += 1) {
        for (let second = first + 1; second < projected.length; second += 1) {
          const a = projected[first];
          const b = projected[second];
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (distance > radius * 0.34 || a.z < -0.48 || b.z < -0.48) continue;
          const alpha = (1 - distance / (radius * 0.34)) * 0.22 * Math.min(a.depth, b.depth);
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.strokeStyle = `rgba(190, 181, 255, ${alpha})`;
          context.lineWidth = 0.65;
          context.stroke();
        }
      }

      projected
        .sort((a, b) => a.z - b.z)
        .forEach((point, index) => {
          const pulse = 0.78 + Math.sin(time * 0.0016 + point.pulse) * 0.22;
          const pointRadius = point.size * (0.55 + point.depth * 0.75) * pulse;
          if (index % 11 === 0 && point.z > -0.15) {
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

      context.save();
      context.translate(centerX, centerY);
      context.rotate(rotation * 0.22);
      const core = context.createRadialGradient(-radius * 0.08, -radius * 0.1, 0, 0, 0, radius * 0.42);
      core.addColorStop(0, "rgba(246, 244, 255, 0.9)");
      core.addColorStop(0.18, "rgba(176, 159, 255, 0.62)");
      core.addColorStop(0.52, "rgba(104, 83, 218, 0.16)");
      core.addColorStop(1, "rgba(74, 57, 160, 0)");
      context.fillStyle = core;
      context.beginPath();
      context.arc(0, 0, radius * 0.42, 0, Math.PI * 2);
      context.fill();
      context.restore();

      if (!reduceMotion) animationFrame = window.requestAnimationFrame(drawOrbital);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    drawOrbital(0);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, []);

  return <canvas ref={canvasRef} className="auth-scene-canvas" aria-hidden="true" />;
}
