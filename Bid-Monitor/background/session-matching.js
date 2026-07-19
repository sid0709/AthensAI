/**
 * Pure helpers for application-session / segment matching.
 * No Chrome APIs — safe to unit-test in Node.
 */
const SessionMatching = (() => {
  const MAIL_DOMAINS = [
    'mail.google.com',
    'gmail.com',
    'outlook.live.com',
    'outlook.office.com',
    'outlook.office365.com',
    'login.microsoftonline.com',
    'mail.yahoo.com',
    'proton.me',
    'mail.proton.me',
  ];

  const ATS_DOMAIN_HINTS = [
    'myworkdayjobs.com',
    'workday.com',
    'wd1.myworkdaysite.com',
    'wd5.myworkdaysite.com',
    'greenhouse.io',
    'boards.greenhouse.io',
    'lever.co',
    'jobs.lever.co',
    'ashbyhq.com',
    'jobs.ashbyhq.com',
    'gusto.com',
    'app.gusto.com',
    'jobvite.com',
    'icims.com',
    'smartrecruiters.com',
    'bamboohr.com',
    'taleo.net',
    'successfactors.com',
    'ultipro.com',
    'paylocity.com',
    'adp.com',
  ];

  const ACTIVE_STATUSES = new Set([
    'recording',
    'waiting_verification',
    'needs_merge',
  ]);

  function extractDomain(url) {
    if (!url || typeof url !== 'string') return '';
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  function domainMatches(a, b) {
    if (!a || !b) return false;
    const left = String(a).toLowerCase().replace(/^www\./, '');
    const right = String(b).toLowerCase().replace(/^www\./, '');
    return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
  }

  function isExternalMailDomain(domain) {
    const d = String(domain || '')
      .toLowerCase()
      .replace(/^www\./, '');
    if (!d) return false;
    return MAIL_DOMAINS.some((mail) => d === mail || d.endsWith(`.${mail}`));
  }

  function isKnownAtsDomain(domain) {
    const d = String(domain || '')
      .toLowerCase()
      .replace(/^www\./, '');
    if (!d) return false;
    return ATS_DOMAIN_HINTS.some((hint) => d === hint || d.endsWith(`.${hint}`) || d.includes(hint));
  }

  function activeSessionsFilter(sessions) {
    if (!Array.isArray(sessions)) return [];
    return sessions.filter((s) => s && ACTIVE_STATUSES.has(s.status));
  }

  /**
   * @param {{
   *   openerTabId?: number|null,
   *   domain?: string,
   *   sessions?: object[],
   *   tabIndex?: Record<string, string>,
   * }} input
   * @returns {{
   *   action: 'auto'|'suggest'|'ask'|'none',
   *   sessionIds: string[],
   *   recommendedSessionId: string|null,
   * }}
   */
  function matchSessionForTab({ openerTabId, domain, sessions = [], tabIndex = {} } = {}) {
    const active = activeSessionsFilter(sessions);

    // Mail must never inherit an application merely because it was opened
    // from a tracked tab.
    if (isExternalMailDomain(domain)) {
      return { action: 'none', sessionIds: [], recommendedSessionId: null };
    }

    if (openerTabId != null && tabIndex) {
      const openerSessionId = tabIndex[String(openerTabId)];
      if (openerSessionId) {
        const openerSession = active.find((s) => s.sessionId === openerSessionId);
        if (openerSession) {
          return {
            action: 'auto',
            sessionIds: [openerSession.sessionId],
            recommendedSessionId: openerSession.sessionId,
          };
        }
      }
      // Also check activeTabIds on sessions
      for (const session of active) {
        if ((session.activeTabIds || []).map(Number).includes(Number(openerTabId))) {
          return {
            action: 'auto',
            sessionIds: [session.sessionId],
            recommendedSessionId: session.sessionId,
          };
        }
      }
    }

    if (!domain) {
      return { action: 'none', sessionIds: [], recommendedSessionId: null };
    }

    const domainMatchesList = active.filter((s) => domainMatches(s.originalDomain, domain));

    if (domainMatchesList.length === 1) {
      return {
        action: 'suggest',
        sessionIds: [domainMatchesList[0].sessionId],
        recommendedSessionId: domainMatchesList[0].sessionId,
      };
    }

    if (domainMatchesList.length > 1) {
      return {
        action: 'ask',
        sessionIds: domainMatchesList.map((s) => s.sessionId),
        recommendedSessionId: null,
      };
    }

    if (isKnownAtsDomain(domain) && active.length > 0) {
      if (active.length === 1) {
        return {
          action: 'suggest',
          sessionIds: [active[0].sessionId],
          recommendedSessionId: active[0].sessionId,
        };
      }
      return {
        action: 'ask',
        sessionIds: active.map((s) => s.sessionId),
        recommendedSessionId: null,
      };
    }

    return { action: 'none', sessionIds: [], recommendedSessionId: null };
  }

  function mergeSegmentIntoSession(session, segment) {
    if (!session || !segment) {
      throw new Error('session and segment required');
    }
    const segmentIds = [...(session.recordingSegmentIds || [])];
    if (!segmentIds.includes(segment.segmentId)) {
      segmentIds.push(segment.segmentId);
    }
    const activeTabIds = [...(session.activeTabIds || [])];
    if (segment.tabId != null && !activeTabIds.map(Number).includes(Number(segment.tabId))) {
      activeTabIds.push(segment.tabId);
    }
    return {
      ...session,
      recordingSegmentIds: segmentIds,
      activeTabIds,
      status: session.status === 'completed' || session.status === 'discarded' ? session.status : 'recording',
      updatedAt: new Date().toISOString(),
    };
  }

  function orderSegmentsForFinalVideo(segments) {
    if (!Array.isArray(segments)) return [];
    return [...segments]
      .filter((s) => s && s.status !== 'discarded' && s.status !== 'unassigned' && s.status !== 'failed')
      .filter((s) => s.status === 'merged' || s.status === 'recording' || s.sessionId)
      .sort((a, b) => {
        const aTime = new Date(a.startedAt || 0).getTime();
        const bTime = new Date(b.startedAt || 0).getTime();
        return aTime - bTime;
      });
  }

  function humanStatus(status) {
    switch (status) {
      case 'recording':
        return 'Recording';
      case 'waiting_verification':
        return 'Waiting on email';
      case 'needs_merge':
        return 'Needs a choice';
      case 'completed':
        return 'Done';
      case 'discarded':
        return 'Discarded';
      default:
        return 'Ready';
    }
  }

  return {
    MAIL_DOMAINS,
    ATS_DOMAIN_HINTS,
    ACTIVE_STATUSES,
    extractDomain,
    domainMatches,
    isExternalMailDomain,
    isKnownAtsDomain,
    activeSessionsFilter,
    matchSessionForTab,
    mergeSegmentIntoSession,
    orderSegmentsForFinalVideo,
    humanStatus,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SessionMatching };
}
