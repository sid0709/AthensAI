import { resolveEndpoint, relaySocketOrigin } from './endpoint';

export const AVALON_SERVER_KEY = 'avalonServerUrl';
export const AVALON_SESSION_KEY = 'avalonSessionId';
export const AVALON_PROFILE_KEY = 'avalonProfileId';
export const FIREBASE_AUTH_KEY = 'avalonFirebaseAuth';
export const AVALON_RELAY_ERROR_KEY = 'avalonRelayLastError';
export const AVALON_RELAY_CONNECTED_KEY = 'avalonRelayConnected';

/** Build-time endpoints may be plain (local .env) or enc:<token> (CI pack). */
export const DEFAULT_SERVER_URL = relaySocketOrigin(
  resolveEndpoint(
    import.meta.env.WXT_AVALON_RELAY_URL,
    'http://127.0.0.1:8979',
  ),
);
export const DEFAULT_ATHENS_API_URL = resolveEndpoint(
  import.meta.env.WXT_API_URL,
  'http://127.0.0.1:8979/api',
);
export const FIREBASE_WEB_API_KEY = String(import.meta.env.WXT_FIREBASE_WEB_API_KEY || '').trim();

/** Side panel opens this port so the MV3 service worker stays alive while connecting. */
export const RELAY_KEEPALIVE_PORT = 'avalon-relay-keepalive';

export const EXTENSION_MESSAGES = {
  EXECUTE_IN_TAB: 'avalon:execute-in-tab',
  EXECUTE_RESULT: 'avalon:execute-result',
  RUN_INJECTION_PLAN: 'avalon:run-injection-plan',
  ATTACH_TAGGED_FILES: 'avalon:attach-tagged-files',
  RUN_SUBMIT: 'avalon:run-submit',
  RELAY_CONNECT: 'avalon:relay-connect',
  RELAY_DISCONNECT: 'avalon:relay-disconnect',
  RELAY_STATUS: 'avalon:relay-status',
} as const;
