import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { DEFAULT_SESSION_ID, SOCKET_EVENTS, type ApplyProgress } from "@avalon/shared";
import { useAuth } from "@/context/auth-context";
import {
  avalonRelayUrl,
  createAvalonSocket,
  storedAvalonSessionId,
  waitForAvalonRelay,
} from "../services/agentApi";

/** Auto-dismiss the overlay this long after a terminal phase. */
const TERMINAL_HIDE_MS = 4000;
const TERMINAL_PHASES: ApplyProgress["phase"][] = ["submitted", "done", "error"];

/**
 * Subscribe to the Avalon relay as a read-only observer and surface the latest
 * apply-progress update (file upload → field fill → submit countdown). Does not
 * take the controller slot, so it never interferes with the Avalon frontend.
 */
export function useApplyProgress(sessionId?: string): ApplyProgress | null {
  const { user } = useAuth();
  const profileId = user?._id != null ? String(user._id) : "";

  const [progress, setProgress] = useState<ApplyProgress | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let socket: Socket | null = null;
    // Follow the session this Athens instance is configured for, not "default".
    const effectiveSessionId = sessionId?.trim() || storedAvalonSessionId() || DEFAULT_SESSION_ID;

    void (async () => {
      await waitForAvalonRelay();
      if (cancelled) return;

      socket = createAvalonSocket(avalonRelayUrl());

      socket.on("connect", () => {
        if (!profileId) return;
        socket?.emit(SOCKET_EVENTS.REGISTER, {
          role: "observer",
          sessionId: effectiveSessionId,
          profileId,
        });
      });

      socket.on(SOCKET_EVENTS.APPLY_PROGRESS, (update: ApplyProgress) => {
        setProgress(update);
        if (hideTimer.current) clearTimeout(hideTimer.current);
        if (TERMINAL_PHASES.includes(update.phase)) {
          hideTimer.current = setTimeout(() => setProgress(null), TERMINAL_HIDE_MS);
        }
      });
    })();

    return () => {
      cancelled = true;
      if (hideTimer.current) clearTimeout(hideTimer.current);
      socket?.removeAllListeners();
      socket?.disconnect();
    };
  }, [sessionId, profileId]);

  return progress;
}
