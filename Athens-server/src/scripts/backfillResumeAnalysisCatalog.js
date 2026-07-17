import dotenv from 'dotenv';
dotenv.config();

import { initMongo, userResumesCollection, accountInfoCollection } from '../db/mongo.js';
import { updateAccountInfoById } from '../services/accountInfoStore.js';

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildCatalogSkillListFromResumes(resumes) {
  // key: lowercased skill name -> { name, category, level }
  const skillByKey = new Map();

  for (const resume of resumes || []) {
    for (const raw of resume.skillProfile || []) {
      const name = String(raw?.name ?? '').trim();
      if (!name) continue;

      const level = Number(raw?.level);
      if (!Number.isFinite(level)) continue;

      const clampedLevel = Math.max(1, Math.min(5, Math.round(level)));
      const category = String(raw?.category ?? '').trim();

      const key = name.toLowerCase();
      const prev = skillByKey.get(key);
      if (!prev || clampedLevel > prev.level) {
        skillByKey.set(key, { name, category, level: clampedLevel });
      }
    }
  }

  return [...skillByKey.values()].sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
}

async function findAccountByOwnerName(ownerName) {
  const trimmed = String(ownerName ?? '').trim();
  if (!trimmed) return null;

  let acc = await accountInfoCollection.findOne({ name: trimmed }, { projection: { _id: 1, name: 1, resumeAnalysisCatalog: 1 } });
  if (acc) return acc;

  const esc = escapeRegExp(trimmed);
  acc = await accountInfoCollection.findOne(
    { name: { $regex: new RegExp(`^${esc}$`, 'i') } },
    { projection: { _id: 1, name: 1, resumeAnalysisCatalog: 1 } },
  );
  return acc || null;
}

async function main() {
  await initMongo();

  if (!userResumesCollection || !accountInfoCollection) {
    console.error('Database not ready');
    process.exit(1);
  }

  // ownerName -> stackName -> skillMap
  const grouped = new Map();

  const cursor = userResumesCollection.find(
    { analyzed: true },
    { projection: { ownerName: 1, techStack: 1, skillProfile: 1 } },
  );

  let processed = 0;
  for await (const resume of cursor) {
    processed += 1;
    const ownerName = String(resume.ownerName ?? '').trim();
    const stack = String(resume.techStack ?? '').trim();
    if (!ownerName || !stack) continue;

    if (!grouped.has(ownerName)) grouped.set(ownerName, new Map());
    const perOwner = grouped.get(ownerName);
    if (!perOwner.has(stack)) perOwner.set(stack, []);
    perOwner.get(stack).push(resume);

    if (processed % 20 === 0) {
      console.log(`Scanned ${processed} analyzed resumes...`);
    }
  }

  const updatedAt = new Date().toISOString();
  let updatedOwners = 0;

  for (const [ownerName, stackMap] of grouped.entries()) {
    const acc = await findAccountByOwnerName(ownerName);
    if (!acc) continue;

    const existingCatalog =
      acc.resumeAnalysisCatalog && typeof acc.resumeAnalysisCatalog === 'object' && !Array.isArray(acc.resumeAnalysisCatalog)
        ? acc.resumeAnalysisCatalog
        : {};

    const updatedCatalog = { ...existingCatalog };
    for (const [stack, resumes] of stackMap.entries()) {
      const skillsList = buildCatalogSkillListFromResumes(resumes);
      if (skillsList.length) updatedCatalog[stack] = skillsList;
    }

    await updateAccountInfoById(acc._id, acc.name, {
      $set: { resumeAnalysisCatalog: updatedCatalog, resumeAnalysisCatalogUpdatedAt: updatedAt },
    });
    updatedOwners += 1;
    console.log(`Updated resumeAnalysisCatalog for ${ownerName} (${updatedOwners} owners).`);
  }

  console.log(`Done. Scanned ${processed} analyzed resumes; updated ${updatedOwners} owners.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('backfillResumeAnalysisCatalog failed', err);
  process.exit(1);
});

