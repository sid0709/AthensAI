export type SignalPoint = {
  latitude: number;
  longitude: number;
  size: number;
  pulse: number;
  scatterX: number;
  scatterY: number;
};

const POINT_COUNT = 62;

export function createSignalPoints(): SignalPoint[] {
  let seed = 24817;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  return Array.from({ length: POINT_COUNT }, () => ({
    latitude: Math.acos(2 * random() - 1),
    longitude: random() * Math.PI * 2,
    size: 0.75 + random() * 1.55,
    pulse: random() * Math.PI * 2,
    scatterX: random() * 2 - 1,
    scatterY: random() * 2 - 1,
  }));
}

export function nextAuthScene(current: number, scrollDelta: number, sceneCount: number) {
  if (sceneCount <= 0) return 0;
  if (scrollDelta === 0) return Math.max(0, Math.min(sceneCount - 1, current));
  return Math.max(0, Math.min(sceneCount - 1, current + Math.sign(scrollDelta)));
}
