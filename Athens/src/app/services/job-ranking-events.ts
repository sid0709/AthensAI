import { io, type Socket } from "socket.io-client";

type RankingReadyEvent = {
  applierName?: string;
  version?: string | null;
  computedAt?: string | null;
};

let socket: Socket | null = null;

function backendOrigin(): string | undefined {
  const raw = String(import.meta.env.SERVER_API_URL || import.meta.env.VITE_API_URL || "").trim();
  if (!raw) return undefined;
  try {
    return new URL(raw, window.location.origin).origin;
  } catch {
    return undefined;
  }
}

function rankingSocket(): Socket {
  if (!socket) {
    socket = io(backendOrigin(), {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1_000,
    });
  }
  return socket;
}

export function subscribeJobRankingReady(
  applierName: string | null | undefined,
  listener: (event: RankingReadyEvent) => void,
): () => void {
  if (!applierName) return () => undefined;
  const current = rankingSocket();
  const handle = (event: RankingReadyEvent) => {
    if (String(event?.applierName || "") === applierName) listener(event);
  };
  current.on("jobs:ranking-ready", handle);
  return () => current.off("jobs:ranking-ready", handle);
}
