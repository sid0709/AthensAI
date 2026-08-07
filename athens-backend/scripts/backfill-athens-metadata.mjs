#!/usr/bin/env node
/**
 * Scan AthensDB.temp_jobs and rebuild athens_metadata membership rows.
 * Title Review + skill extract operate on temp_jobs only; searchable jobs
 * stay in `jobs` and are not queued.
 *
 * title_review:
 *   PENDING label → state pending
 *   REVIEW_REQUIRED label → state review_required
 *   metadata.titleReview.processingState === failed → state failed
 *
 * skill_extract (APPROVED titles only):
 *   aiSkillStatus pending → state pending
 *   aiSkillStatus failed → state failed
 *
 * Usage: npm run backfill:metadata
 */
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';

const QUEUES = {
  TITLE_REVIEW: 'title_review',
  SKILL_EXTRACT: 'skill_extract',
};

function requireDbUrl() {
  const url = String(process.env.DATABASE_URL || '').trim();
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  return url;
}

function asId(value) {
  if (value instanceof ObjectId) return value;
  if (value && typeof value === 'object' && value.$oid) {
    return ObjectId.createFromHexString(String(value.$oid));
  }
  return ObjectId.createFromHexString(String(value));
}

async function main() {
  const url = requireDbUrl();
  const client = new MongoClient(url);
  await client.connect();
  const db = client.db();
  const tempJobs = db.collection('temp_jobs');
  const meta = db.collection('athens_metadata');

  console.log(`[backfill:metadata] db=${db.databaseName} source=temp_jobs`);

  const now = new Date();
  const docs = [];

  const titleCursor = tempJobs.find(
    {
      $or: [
        { titleReviewLabel: { $in: ['PENDING', 'REVIEW_REQUIRED'] } },
        { 'metadata.titleReview.processingState': 'failed' },
      ],
    },
    {
      projection: {
        _id: 1,
        titleReviewLabel: 1,
        'metadata.titleReview.processingState': 1,
      },
    },
  );

  for await (const job of titleCursor) {
    const processingState = job?.metadata?.titleReview?.processingState;
    let state = null;
    if (processingState === 'failed') state = 'failed';
    else if (job.titleReviewLabel === 'REVIEW_REQUIRED') state = 'review_required';
    else if (job.titleReviewLabel === 'PENDING') state = 'pending';
    if (!state) continue;
    docs.push({
      queue: QUEUES.TITLE_REVIEW,
      state,
      jobId: asId(job._id),
      createdAt: now,
      updatedAt: now,
    });
  }

  const skillCursor = tempJobs.find(
    {
      titleReviewLabel: 'APPROVED',
      aiSkillStatus: { $in: ['pending', 'failed'] },
    },
    { projection: { _id: 1, aiSkillStatus: 1 } },
  );

  for await (const job of skillCursor) {
    const state = job.aiSkillStatus === 'failed' ? 'failed' : 'pending';
    docs.push({
      queue: QUEUES.SKILL_EXTRACT,
      state,
      jobId: asId(job._id),
      createdAt: now,
      updatedAt: now,
    });
  }

  await meta.deleteMany({});
  if (docs.length) {
    const chunk = 1000;
    for (let i = 0; i < docs.length; i += chunk) {
      await meta.insertMany(docs.slice(i, i + chunk), { ordered: false });
    }
  }

  const titlePending = await meta.countDocuments({
    queue: QUEUES.TITLE_REVIEW,
    state: 'pending',
  });
  const titleRr = await meta.countDocuments({
    queue: QUEUES.TITLE_REVIEW,
    state: 'review_required',
  });
  const titleFailed = await meta.countDocuments({
    queue: QUEUES.TITLE_REVIEW,
    state: 'failed',
  });
  const skillPending = await meta.countDocuments({
    queue: QUEUES.SKILL_EXTRACT,
    state: 'pending',
  });
  const skillFailed = await meta.countDocuments({
    queue: QUEUES.SKILL_EXTRACT,
    state: 'failed',
  });

  console.log('[backfill:metadata] inserted', docs.length, 'rows');
  console.log('[backfill:metadata] title_review', {
    pending: titlePending,
    review_required: titleRr,
    failed: titleFailed,
  });
  console.log('[backfill:metadata] skill_extract', {
    pending: skillPending,
    failed: skillFailed,
    badge: skillPending + skillFailed,
  });

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
