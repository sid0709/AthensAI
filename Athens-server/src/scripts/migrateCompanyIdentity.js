import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FieldPath } from 'firebase-admin/firestore';
import { getFirestoreDb } from '../services/firebase/firebaseAdmin.js';
import {
  COMPANY_IDENTITY_VERSION,
  companyAliasId,
  companyIdFor,
  extractCompanyDomain,
  normalizeCompanyName,
} from '../services/companyIdentity.js';

const APPLY = process.argv.includes('--apply');
const VERIFY_ONLY = process.argv.includes('--verify');
const BACKUP_CONFIRMED = process.argv.includes('--backup-confirmed');
const BATCH_SIZE = Math.max(25, Math.min(400, Number(process.env.COMPANY_MIGRATION_BATCH || 250)));
const resumeArg = process.argv.find((arg) => arg.startsWith('--resume-after='));
const RESUME_AFTER = resumeArg ? resumeArg.slice('--resume-after='.length) : '';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(__dirname, '../../migration-output');

function companyName(job = {}) {
  return typeof job.company === 'string' ? job.company : job.company?.name || job.companyName || '';
}

function identityFor(job, domainsByName, jobId) {
  const canonicalName = String(companyName(job)).trim();
  const normalizedName = normalizeCompanyName(canonicalName);
  const directDomain = extractCompanyDomain(job.companyLink);
  const domains = normalizedName ? domainsByName.get(normalizedName) : null;
  const inheritedDomain = !directDomain && domains?.size === 1 ? [...domains][0] : null;
  const domain = directDomain || inheritedDomain;
  const ambiguous = !directDomain && domains?.size > 1;
  const kind = domain ? 'domain' : normalizedName ? 'name' : 'unknown';
  const value = domain || normalizedName || jobId;
  return {
    companyId: companyIdFor(kind, value),
    companyNameNormalized: normalizedName,
    ...(domain ? { companyDomain: domain } : {}),
    companyIdentitySource: kind,
    companyIdentityVersion: COMPANY_IDENTITY_VERSION,
    ...(ambiguous ? { companyIdentityConflict: true } : {}),
    canonicalName: canonicalName || 'Unknown',
  };
}

async function readRows(db) {
  const rows = [];
  let query = db.collection('jobs')
    .where('sourceCatalog', '==', 'market')
    .orderBy(FieldPath.documentId())
    .select('company', 'companyName', 'companyLink', 'companyId', 'companyIdentityVersion');
  if (RESUME_AFTER) query = query.startAfter(RESUME_AFTER);
  const stream = query.stream();
  for await (const snapshot of stream) rows.push({ id: snapshot.id, ...snapshot.data() });
  return rows;
}

async function verify(rows) {
  const invalid = rows.filter((row) => !row.companyId || Number(row.companyIdentityVersion) !== COMPANY_IDENTITY_VERSION);
  const ids = new Set(rows.map((row) => row.companyId).filter(Boolean));
  return { jobs: rows.length, companies: ids.size, invalid: invalid.length, invalidIds: invalid.slice(0, 50).map((row) => row.id) };
}

async function writeReport(report) {
  await fs.mkdir(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(outputDir, `company-identity-${APPLY ? 'apply' : VERIFY_ONLY ? 'verify' : 'dry-run'}-${stamp}.json`);
  await fs.writeFile(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return file;
}

async function main() {
  if (APPLY && !BACKUP_CONFIRMED) {
    throw new Error('--apply requires --backup-confirmed after verifying a current Firestore backup/export');
  }
  const db = getFirestoreDb();
  const rows = await readRows(db);
  if (VERIFY_ONLY) {
    const report = await verify(rows);
    report.reportFile = await writeReport(report);
    console.log('[company-identity] verify', report);
    if (report.invalid) process.exitCode = 2;
    return;
  }

  const domainsByName = new Map();
  for (const row of rows) {
    const normalizedName = normalizeCompanyName(companyName(row));
    const domain = extractCompanyDomain(row.companyLink);
    if (!normalizedName || !domain) continue;
    if (!domainsByName.has(normalizedName)) domainsByName.set(normalizedName, new Set());
    domainsByName.get(normalizedName).add(domain);
  }

  const identities = rows.map((row) => ({ row, identity: identityFor(row, domainsByName, row.id) }));
  const ambiguous = identities.filter(({ identity }) => identity.companyIdentityConflict);
  const unknown = identities.filter(({ identity }) => identity.companyIdentitySource === 'unknown');
  const report = {
    mode: APPLY ? 'apply' : 'dry-run',
    scanned: rows.length,
    companies: new Set(identities.map(({ identity }) => identity.companyId)).size,
    ambiguous: ambiguous.length,
    ambiguousExamples: ambiguous.slice(0, 100).map(({ row, identity }) => ({ jobId: row.id, company: companyName(row), companyId: identity.companyId })),
    unknown: unknown.length,
    resumeAfter: RESUME_AFTER || null,
  };

  if (APPLY) {
    const existingAliases = new Map();
    for await (const alias of db.collection('company_aliases').stream()) {
      existingAliases.set(alias.id, alias.data().companyId);
    }
    let written = 0;
    let aliasConflicts = 0;
    for (let offset = 0; offset < identities.length; offset += BATCH_SIZE) {
      const writer = db.bulkWriter();
      const chunk = identities.slice(offset, offset + BATCH_SIZE);
      for (const { row, identity } of chunk) {
        const { canonicalName, ...jobPatch } = identity;
        writer.set(db.collection('jobs').doc(row.id), jobPatch, { merge: true });
        writer.set(db.collection('companies').doc(identity.companyId), {
          canonicalName,
          normalizedName: identity.companyNameNormalized,
          ...(identity.companyDomain ? { domain: identity.companyDomain } : {}),
          identityVersion: COMPANY_IDENTITY_VERSION,
          updatedAt: new Date(),
        }, { merge: true });
        for (const [kind, value] of [['domain', identity.companyDomain], ['name', identity.companyNameNormalized]]) {
          if (!value) continue;
          const aliasId = companyAliasId(kind, value);
          const existing = existingAliases.get(aliasId);
          if (existing && existing !== identity.companyId) {
            aliasConflicts += 1;
            continue;
          }
          existingAliases.set(aliasId, identity.companyId);
          writer.set(db.collection('company_aliases').doc(aliasId), {
            companyId: identity.companyId,
            kind,
            normalizedValue: value,
            updatedAt: new Date(),
          }, { merge: true });
        }
      }
      await writer.close();
      written += chunk.length;
      await db.collection('migration_state').doc('company_identity_v1').set({
        status: 'running',
        written,
        lastJobId: chunk.at(-1)?.row.id || null,
        updatedAt: new Date(),
      }, { merge: true });
      console.log(`[company-identity] ${written}/${identities.length}`);
    }
    report.written = written;
    report.aliasConflicts = aliasConflicts;
    await db.collection('migration_state').doc('company_identity_v1').set({ status: 'complete', ...report, completedAt: new Date() }, { merge: true });
  }

  report.reportFile = await writeReport(report);
  console.log('[company-identity] complete', report);
}

main().catch((error) => {
  console.error('[company-identity] failed:', error);
  process.exitCode = 1;
});
