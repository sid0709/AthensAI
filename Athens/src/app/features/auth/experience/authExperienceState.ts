export const FULL_INTRO_MS = 2_400;
export const REPEAT_INTRO_MS = 900;
export const REDUCED_INTRO_MS = 220;
export const IGNITION_MS = 200;
export const TRAVEL_MS = 1_100;
export const REVEAL_MS = 400;
export const REDUCED_REVEAL_MS = 260;
export const FAILURE_MS = 350;
export const DESTINATION_TIMEOUT_MS = 4_000;

export type AuthExperiencePhase =
  | "intro"
  | "idle"
  | "authenticating"
  | "failure"
  | "ignition"
  | "travel"
  | "reveal";

export type IntroVariant = "full" | "repeat" | "none";

export type AuthExperienceState = {
  phase: AuthExperiencePhase;
  phaseStartedAt: number;
  journeyStartedAt: number | null;
  introVariant: IntroVariant;
  introDurationMs: number;
  scene: number;
  accountName: string | null;
  destinationReady: boolean;
  travelFinished: boolean;
  skipRequested: boolean;
  offline: boolean;
};

export type AuthExperienceAction =
  | { type: "ENTER_SIGNIN"; now: number; seenIntro: boolean; reducedMotion: boolean }
  | { type: "INTRO_COMPLETE"; now: number }
  | { type: "SET_SCENE"; scene: number }
  | { type: "BEGIN_AUTH"; now: number }
  | { type: "AUTH_FAILED"; now: number }
  | { type: "FAILURE_COMPLETE"; now: number }
  | { type: "AUTH_SUCCEEDED"; now: number; accountName?: string | null; offline: boolean }
  | { type: "IGNITION_COMPLETE"; now: number }
  | { type: "TRAVEL_COMPLETE"; now: number; force?: boolean }
  | { type: "APP_SHELL_READY"; now: number }
  | { type: "SET_OFFLINE"; offline: boolean }
  | { type: "REQUEST_SKIP"; now: number }
  | { type: "REVEAL_COMPLETE"; now: number }
  | { type: "RESET_IDLE"; now: number };

export function resolveAuthIdentity(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function introDuration(seenIntro: boolean, reducedMotion: boolean) {
  if (reducedMotion) return REDUCED_INTRO_MS;
  return seenIntro ? REPEAT_INTRO_MS : FULL_INTRO_MS;
}

export function createAuthExperienceState({
  now,
  shouldIntro,
  seenIntro,
  reducedMotion,
}: {
  now: number;
  shouldIntro: boolean;
  seenIntro: boolean;
  reducedMotion: boolean;
}): AuthExperienceState {
  return {
    phase: shouldIntro ? "intro" : "idle",
    phaseStartedAt: now,
    journeyStartedAt: null,
    introVariant: shouldIntro ? (seenIntro ? "repeat" : "full") : "none",
    introDurationMs: shouldIntro ? introDuration(seenIntro, reducedMotion) : 0,
    scene: 0,
    accountName: null,
    destinationReady: false,
    travelFinished: false,
    skipRequested: false,
    offline: false,
  };
}

function beginReveal(state: AuthExperienceState, now: number): AuthExperienceState {
  return {
    ...state,
    phase: "reveal",
    phaseStartedAt: now,
    travelFinished: true,
  };
}

export function authExperienceReducer(
  state: AuthExperienceState,
  action: AuthExperienceAction,
): AuthExperienceState {
  switch (action.type) {
    case "ENTER_SIGNIN":
      return createAuthExperienceState({
        now: action.now,
        shouldIntro: true,
        seenIntro: action.seenIntro,
        reducedMotion: action.reducedMotion,
      });
    case "INTRO_COMPLETE":
      if (state.phase !== "intro") return state;
      return { ...state, phase: "idle", phaseStartedAt: action.now, introDurationMs: 0 };
    case "SET_SCENE":
      return { ...state, scene: action.scene };
    case "BEGIN_AUTH":
      if (state.phase !== "idle" && state.phase !== "failure") return state;
      return {
        ...state,
        phase: "authenticating",
        phaseStartedAt: action.now,
        journeyStartedAt: null,
        accountName: null,
        destinationReady: false,
        travelFinished: false,
        skipRequested: false,
        offline: false,
      };
    case "AUTH_FAILED":
      if (state.phase !== "authenticating") return state;
      return { ...state, phase: "failure", phaseStartedAt: action.now };
    case "FAILURE_COMPLETE":
      if (state.phase !== "failure") return state;
      return { ...state, phase: "idle", phaseStartedAt: action.now };
    case "AUTH_SUCCEEDED":
      if (state.phase !== "authenticating") return state;
      return {
        ...state,
        phase: "ignition",
        phaseStartedAt: action.now,
        journeyStartedAt: action.now,
        accountName: resolveAuthIdentity(action.accountName),
        destinationReady: false,
        travelFinished: false,
        skipRequested: false,
        offline: action.offline,
      };
    case "IGNITION_COMPLETE":
      if (state.phase !== "ignition") return state;
      return { ...state, phase: "travel", phaseStartedAt: action.now };
    case "TRAVEL_COMPLETE":
      if (state.phase !== "travel" && state.phase !== "ignition") return state;
      if (state.destinationReady || action.force) return beginReveal(state, action.now);
      return { ...state, phase: "travel", travelFinished: true };
    case "APP_SHELL_READY": {
      if (state.phase === "travel" && (state.travelFinished || state.skipRequested)) {
        return beginReveal({ ...state, destinationReady: true }, action.now);
      }
      if (state.phase === "ignition" && state.skipRequested) {
        return beginReveal({ ...state, destinationReady: true }, action.now);
      }
      return { ...state, destinationReady: true };
    }
    case "SET_OFFLINE":
      return { ...state, offline: action.offline };
    case "REQUEST_SKIP":
      if (state.phase === "intro") {
        return { ...state, phase: "idle", phaseStartedAt: action.now, introDurationMs: 0 };
      }
      if (state.phase === "failure") {
        return { ...state, phase: "idle", phaseStartedAt: action.now };
      }
      if (state.phase === "ignition" || state.phase === "travel") {
        if (state.destinationReady) return beginReveal(state, action.now);
        return { ...state, skipRequested: true, travelFinished: true };
      }
      return state;
    case "REVEAL_COMPLETE":
      if (state.phase !== "reveal") return state;
      return {
        ...state,
        phase: "idle",
        phaseStartedAt: action.now,
        journeyStartedAt: null,
        skipRequested: false,
      };
    case "RESET_IDLE":
      return {
        ...state,
        phase: "idle",
        phaseStartedAt: action.now,
        journeyStartedAt: null,
        introVariant: "none",
        introDurationMs: 0,
        accountName: null,
        destinationReady: false,
        travelFinished: false,
        skipRequested: false,
      };
    default:
      return state;
  }
}

export function isSuccessPhase(phase: AuthExperiencePhase) {
  return phase === "ignition" || phase === "travel" || phase === "reveal";
}
