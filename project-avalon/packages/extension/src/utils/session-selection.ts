import type { RelaySessionInfo } from '@avalon/shared';

export type DiscoverableRelaySession = RelaySessionInfo & { id?: string };

export function relaySessionKey(session: DiscoverableRelaySession): string {
  return session.sessionId || session.id || '';
}

export function selectRelaySession(
  previous: string,
  sessions: DiscoverableRelaySession[],
): string {
  if (previous && sessions.some((session) => relaySessionKey(session) === previous)) return previous;
  return sessions.length === 1 ? relaySessionKey(sessions[0]) : '';
}
