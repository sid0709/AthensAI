import type { NextFunction, Request, Response } from 'express';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { OAuth2Client } from 'google-auth-library';

const googleVerifier = new OAuth2Client();
const accessCache = new Map<string, { expiresAt: number; profileIds: Set<string>; profileNames: Set<string> }>();

function required() {
  const raw = String(process.env.FIREBASE_AUTH_REQUIRED ?? '').trim().toLowerCase();
  if (raw) return !['0', 'false', 'no', 'off'].includes(raw);
  return process.env.NODE_ENV === 'production';
}

function ensureFirebaseApp() {
  if (getApps().length) return getApps()[0];
  return initializeApp({
    credential: applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID?.trim() || undefined,
  });
}

async function accessFor(uid: string) {
  const cached = accessCache.get(uid);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const snapshot = await getFirestore().collection('profile_access').where('uid', '==', uid).get();
  const grants = snapshot.docs.map((doc) => doc.data());
  const access = {
    expiresAt: Date.now() + 60_000,
    profileIds: new Set(grants.map((grant) => String(grant.profileId || '')).filter(Boolean)),
    profileNames: new Set(
      grants.flatMap((grant) => [grant.profileName, grant.applierName])
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean),
    ),
  };
  accessCache.set(uid, access);
  return access;
}

export async function requireFirebaseAuth(req: Request, res: Response, next: NextFunction) {
  if (req.path === '/health' || req.path === '/healthz') return next();
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    if (!required()) return next();
    return res.status(401).json({ error: 'Firebase ID token required' });
  }
  try {
    ensureFirebaseApp();
    const decoded = await getAuth().verifyIdToken(token, true);
    const role = String(decoded.role || '').toLowerCase();
    if (role === 'bidder') return res.status(403).json({ error: 'Bidder role cannot call AI services directly' });
    if (decoded.admin !== true && role !== 'admin') {
      const access = await accessFor(decoded.uid);
      const requested = [
        (req.body as Record<string, unknown> | undefined)?.applierName,
        (req.body as Record<string, unknown> | undefined)?.profileId,
        req.headers['x-applier-name'],
      ].map((value) => String(value || '').trim()).filter(Boolean);
      if (!access.profileIds.size && !access.profileNames.size) return res.status(403).json({ error: 'A profile grant is required' });
      if (requested.some((value) => !access.profileIds.has(value) && !access.profileNames.has(value.toLowerCase()))) {
        return res.status(403).json({ error: 'Profile access denied' });
      }
    }
    (req as Request & { firebaseAuth?: typeof decoded }).firebaseAuth = decoded;
    return next();
  } catch (firebaseError) {
    try {
      const audience = String(process.env.SERVICE_AUTH_AUDIENCE || '').trim();
      const allowed = new Set(
        String(process.env.ALLOWED_SERVICE_ACCOUNTS || '')
          .split(',')
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean),
      );
      if (!audience || allowed.size === 0) throw firebaseError;
      const ticket = await googleVerifier.verifyIdToken({ idToken: token, audience });
      const payload = ticket.getPayload();
      const email = String(payload?.email || '').toLowerCase();
      if (!payload?.email_verified || !allowed.has(email)) throw firebaseError;
      (req as Request & { serviceAuth?: typeof payload }).serviceAuth = payload;
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid Firebase or service identity token' });
    }
  }
}
