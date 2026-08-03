import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router";
import { useAuth } from "@/context/auth-context";
import { PATHS } from "../../../config/routes";
import {
  AUTH_SOUND_SESSION_KEY,
  AuthSoundEngine,
  normalizeSoundPreference,
  shouldAutoEnableSound,
  type AuthSoundPreference,
} from "./authAudio";
import {
  DESTINATION_TIMEOUT_MS,
  FAILURE_MS,
  IGNITION_MS,
  REDUCED_REVEAL_MS,
  REVEAL_MS,
  TRAVEL_MS,
  authExperienceReducer,
  createAuthExperienceState,
  isSuccessPhase,
  type AuthExperiencePhase,
  type IntroVariant,
} from "./authExperienceState";

const AUTH_INTRO_SEEN_KEY = "athens_auth_intro_seen_v1";

type AuthExperienceContextValue = {
  phase: AuthExperiencePhase;
  phaseStartedAt: number;
  introVariant: IntroVariant;
  introDurationMs: number;
  scene: number;
  accountName: string | null;
  offline: boolean;
  reducedMotion: boolean;
  introActive: boolean;
  authenticating: boolean;
  transitionActive: boolean;
  layerVisible: boolean;
  soundEnabled: boolean;
  setScene: (scene: number) => void;
  beginAttempt: () => void;
  failAttempt: () => void;
  completeAttempt: (accountName?: string | null) => void;
  markAppShellReady: () => void;
  skip: () => void;
  toggleSound: () => void;
  registerInteraction: () => void;
};

const AuthExperienceContext = createContext<AuthExperienceContextValue | null>(null);

function safeSessionGet(key: string) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionSet(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Session storage may be disabled; the experience still works without persistence.
  }
}

function motionPreference() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function AuthExperienceProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { user, isAuthenticated } = useAuth();
  const initialReducedMotion = motionPreference();
  const [reducedMotion, setReducedMotion] = useState(initialReducedMotion);
  const [state, dispatch] = useReducer(
    authExperienceReducer,
    undefined,
    () => createAuthExperienceState({
      now: Date.now(),
      shouldIntro: location.pathname === PATHS.signin && !isAuthenticated,
      seenIntro: safeSessionGet(AUTH_INTRO_SEEN_KEY) === "1",
      reducedMotion: initialReducedMotion,
    }),
  );
  const previousPath = useRef(location.pathname);
  const soundEngine = useRef<AuthSoundEngine | null>(null);
  const [soundPreference, setSoundPreference] = useState<AuthSoundPreference>(() =>
    normalizeSoundPreference(safeSessionGet(AUTH_SOUND_SESSION_KEY)),
  );
  const [soundEnabled, setSoundEnabled] = useState(false);

  const isAuthRoute = location.pathname === PATHS.signin || location.pathname === PATHS.signup;
  const transitionActive = isSuccessPhase(state.phase);
  const layerVisible = isAuthRoute || state.phase !== "idle";

  const markIntroSeen = useCallback(() => safeSessionSet(AUTH_INTRO_SEEN_KEY, "1"), []);

  const activateSound = useCallback(async (explicit = false) => {
    if (!explicit && !shouldAutoEnableSound(soundPreference)) return;
    const engine = soundEngine.current ?? new AuthSoundEngine();
    soundEngine.current = engine;
    const enabled = await engine.enable();
    if (!enabled) return;
    setSoundEnabled(true);
    if (explicit || soundPreference !== "off") {
      setSoundPreference("on");
      safeSessionSet(AUTH_SOUND_SESSION_KEY, "on");
    }
  }, [soundPreference]);

  const registerInteraction = useCallback(() => {
    if (!soundEnabled) void activateSound(false);
  }, [activateSound, soundEnabled]);

  const toggleSound = useCallback(() => {
    if (soundEnabled) {
      soundEngine.current?.disable();
      setSoundEnabled(false);
      setSoundPreference("off");
      safeSessionSet(AUTH_SOUND_SESSION_KEY, "off");
      return;
    }
    setSoundPreference("on");
    safeSessionSet(AUTH_SOUND_SESSION_KEY, "on");
    void activateSound(true);
  }, [activateSound, soundEnabled]);

  const skip = useCallback(() => {
    if (state.phase === "intro") markIntroSeen();
    dispatch({ type: "REQUEST_SKIP", now: Date.now() });
  }, [markIntroSeen, state.phase]);

  const beginAttempt = useCallback(() => {
    registerInteraction();
    dispatch({ type: "BEGIN_AUTH", now: Date.now() });
  }, [registerInteraction]);

  const failAttempt = useCallback(() => {
    dispatch({ type: "AUTH_FAILED", now: Date.now() });
  }, []);

  const completeAttempt = useCallback((accountName?: string | null) => {
    dispatch({
      type: "AUTH_SUCCEEDED",
      now: Date.now(),
      accountName,
      offline: typeof navigator !== "undefined" && !navigator.onLine,
    });
  }, []);

  const markAppShellReady = useCallback(() => {
    dispatch({ type: "APP_SHELL_READY", now: Date.now() });
  }, []);

  const setScene = useCallback((scene: number) => {
    dispatch({ type: "SET_SCENE", scene });
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const enteredSignin = location.pathname === PATHS.signin && previousPath.current !== PATHS.signin;
    if (enteredSignin && !isAuthenticated) {
      dispatch({
        type: "ENTER_SIGNIN",
        now: Date.now(),
        seenIntro: safeSessionGet(AUTH_INTRO_SEEN_KEY) === "1",
        reducedMotion,
      });
    }
    previousPath.current = location.pathname;
  }, [isAuthenticated, location.pathname, reducedMotion]);

  useEffect(() => {
    if (state.phase === "authenticating" && user) completeAttempt(user.name);
  }, [completeAttempt, state.phase, user]);

  useEffect(() => {
    let timer: number | undefined;
    if (state.phase === "intro") {
      timer = window.setTimeout(() => {
        markIntroSeen();
        dispatch({ type: "INTRO_COMPLETE", now: Date.now() });
      }, state.introDurationMs);
    } else if (state.phase === "failure") {
      timer = window.setTimeout(
        () => dispatch({ type: "FAILURE_COMPLETE", now: Date.now() }),
        reducedMotion ? 100 : FAILURE_MS,
      );
    } else if (state.phase === "ignition") {
      timer = window.setTimeout(
        () => dispatch({ type: "IGNITION_COMPLETE", now: Date.now() }),
        reducedMotion ? 80 : IGNITION_MS,
      );
    } else if (state.phase === "travel" && !state.travelFinished) {
      timer = window.setTimeout(
        () => dispatch({ type: "TRAVEL_COMPLETE", now: Date.now() }),
        reducedMotion ? 80 : TRAVEL_MS,
      );
    } else if (state.phase === "reveal") {
      timer = window.setTimeout(
        () => dispatch({ type: "REVEAL_COMPLETE", now: Date.now() }),
        reducedMotion ? REDUCED_REVEAL_MS : REVEAL_MS,
      );
    }
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [markIntroSeen, reducedMotion, state.introDurationMs, state.phase, state.travelFinished]);

  useEffect(() => {
    if (!state.journeyStartedAt || !transitionActive) return;
    const elapsed = Date.now() - state.journeyStartedAt;
    const timer = window.setTimeout(
      () => dispatch({ type: "TRAVEL_COMPLETE", now: Date.now(), force: true }),
      Math.max(0, DESTINATION_TIMEOUT_MS - elapsed),
    );
    return () => window.clearTimeout(timer);
  }, [state.journeyStartedAt, transitionActive]);

  useEffect(() => {
    const setConnection = () => dispatch({ type: "SET_OFFLINE", offline: !navigator.onLine });
    window.addEventListener("online", setConnection);
    window.addEventListener("offline", setConnection);
    return () => {
      window.removeEventListener("online", setConnection);
      window.removeEventListener("offline", setConnection);
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-auth-silent-action]")) return;
      registerInteraction();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (state.phase === "intro" || transitionActive)) {
        event.preventDefault();
        skip();
        return;
      }
      if (event.key !== "Escape") registerInteraction();
    };
    if (isAuthRoute || transitionActive) {
      window.addEventListener("pointerdown", onPointerDown, { passive: true });
      window.addEventListener("keydown", onKeyDown);
    }
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isAuthRoute, registerInteraction, skip, state.phase, transitionActive]);

  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) return;
      if (state.phase === "intro") {
        markIntroSeen();
        dispatch({ type: "INTRO_COMPLETE", now: Date.now() });
      } else if (transitionActive) {
        dispatch({ type: "TRAVEL_COMPLETE", now: Date.now(), force: true });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [markIntroSeen, state.phase, transitionActive]);

  useEffect(() => {
    const engine = soundEngine.current;
    if (layerVisible && soundEnabled) void engine?.enable();
    if (!layerVisible) engine?.disable();
  }, [layerVisible, soundEnabled]);

  useEffect(() => {
    if (!soundEnabled) return;
    if (state.phase === "authenticating") soundEngine.current?.playScan();
    if (state.phase === "failure") soundEngine.current?.playFailure();
    if (state.phase === "ignition") soundEngine.current?.playIgnition();
    if (state.phase === "travel") soundEngine.current?.playTravel();
  }, [soundEnabled, state.phase]);

  useEffect(() => () => soundEngine.current?.dispose(), []);

  const value = useMemo<AuthExperienceContextValue>(() => ({
    phase: state.phase,
    phaseStartedAt: state.phaseStartedAt,
    introVariant: state.introVariant,
    introDurationMs: state.introDurationMs,
    scene: state.scene,
    accountName: state.accountName,
    offline: state.offline,
    reducedMotion,
    introActive: state.phase === "intro",
    authenticating: state.phase === "authenticating",
    transitionActive,
    layerVisible,
    soundEnabled,
    setScene,
    beginAttempt,
    failAttempt,
    completeAttempt,
    markAppShellReady,
    skip,
    toggleSound,
    registerInteraction,
  }), [
    beginAttempt,
    completeAttempt,
    failAttempt,
    layerVisible,
    markAppShellReady,
    reducedMotion,
    registerInteraction,
    setScene,
    skip,
    soundEnabled,
    state,
    toggleSound,
    transitionActive,
  ]);

  return <AuthExperienceContext.Provider value={value}>{children}</AuthExperienceContext.Provider>;
}

export function useAuthExperience() {
  const context = useContext(AuthExperienceContext);
  if (!context) throw new Error("useAuthExperience must be used within AuthExperienceProvider");
  return context;
}
