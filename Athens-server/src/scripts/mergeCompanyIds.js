import 'dotenv/config';
import { getFirestoreDb } from '../services/firebase/firebaseAdmin.js';
import { COMPANY_IDENTITY_VERSION } from '../services/companyIdentity.js';

const args = Object.fromEntries(process.argv.slice(2).flatMap((arg) => {
  const match = arg.match(/^--([^=]+)=(.*)$/s);
  return match ? [[match[1], match[2]]] : [];
}));
const APPLY = process.argv.includes('--apply');
const BACKUP_CONFIRMED = process.argv.includes('--backup-confirmed');
const FROM = String(args.from || '').trim();
const TO = String(args.to || '').trim();
const BATCH_SIZE = Math.max(25, Math.min(400, Number(process.env.COMPANY_MERGE_BATCH || 200)));

async function loadMerge(db) {
  const jobs = [];
  const jobStream = db.collection('job_market')
    .where('companyId', '==', FROM)
    .stream();
  for await (const snapshot of jobStream) jobs.push({ id: snapshot.id, ...snapshot.data() });

  const aliases = [];
  const aliasStream = db.collection('company_aliases').where('companyId', '==', FROM).stream();
  for await (const snapshot of aliasStream) aliases.push({ id: snapshot.id, ...snapshot.data() });
  return { jobs, aliases };
}

async function main() {
  if (!FROM || !TO) throw new Error('Usage: npm run merge-companies -- --from=cmp_old --to=cmp_new [--apply --backup-confirmed]');
  if (FROM === TO) throw new Error('--from and --to must be different company IDs');
  if (APPLY && !BACKUP_CONFIRMED) throw new Error('--apply requires --backup-confirmed');

  const db = getFirestoreDb();
  const target = await db.collection('companies').doc(TO).get();
  if (!target.exists) throw new Error(`Target company ${TO} does not exist`);
  const { jobs, aliases } = await loadMerge(db);
  const report = {
    mode: APPLY ? 'apply' : 'dry-run',
    from: FROM,
    to: TO,
    jobs: jobs.length,
    aliases: aliases.length,
    sampleJobIds: jobs.slice(0, 25).map((job) => job.id),
  };
  if (!APPLY) {
    console.log('[company-merge] dry run', report);
    return;
  }

  let written = 0;
  for (let offset = 0; offset < jobs.length; offset += BATCH_SIZE) {
    const chunk = jobs.slice(offset, offset + BATCH_SIZE);
    const writer = db.bulkWriter();
    const now = new Date();
    for (const job of chunk) {
      writer.set(db.collection('job_market').doc(job.id), {
        companyId: TO,
        companyIdentitySource: 'manual',
        companyIdentityVersion: COMPANY_IDENTITY_VERSION,
        companyIdentityUpdatedAt: now,
      }, { merge: true });
		writer.create(db.collection('search_outbox').doc(), {
			jobId: job.id,
			operation: 'upsert',
			status: 'pending',
			attempts: 0,
			createdAt: now,
			updatedAt: now,
		});
    }
    await writer.close();
    written += chunk.length;
    console.log(`[company-merge] jobs ${written}/${jobs.length}`);
  }

  const writer = db.bulkWriter();
  const mergedAt = new Date();
  for (const alias of aliases) {
    writer.set(db.collection('company_aliases').doc(alias.id), {
      companyId: TO,
      updatedAt: mergedAt,
    }, { merge: true });
  }
  writer.set(db.collection('companies').doc(FROM), {
    mergedInto: TO,
    mergedAt,
    updatedAt: mergedAt,
  }, { merge: true });
  writer.set(db.collection('companies').doc(TO), { updatedAt: mergedAt }, { merge: true });
  await writer.close();
  report.written = written;
  console.log('[company-merge] complete', report);
}

main().catch((error) => {
  console.error('[company-merge] failed:', error);
  process.exitCode = 1;
});
