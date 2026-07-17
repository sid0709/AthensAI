import {
  listUserSkills,
  upsertUserSkill,
  removeUserSkill,
} from '../services/matching/userSkillsService.js';
import { loadProfileMatchContext } from '../services/matching/profileSkills.js';
import { computeSkillHighlights } from '@nextoffer/shared/skill-match';
import { computeCoverageScore } from '../services/matching/coverageScore.js';
import {
  USER_SKILL_CATEGORIES,
  USER_SKILL_LEVEL_MIN,
  USER_SKILL_LEVEL_MAX,
} from '../config/graphAndVectorConfig.js';

/**
 * Manual user skill management (name + category + level). These skills are the
 * sole input to weighted match scoring; every mutation queues a background
 * rescore of the user's materialized job scores.
 */

async function contextPayload(applierName) {
  const [skills, ctx] = await Promise.all([
    listUserSkills(applierName),
    loadProfileMatchContext(applierName),
  ]);
  return {
    skills,
    categories: USER_SKILL_CATEGORIES,
    levelMin: USER_SKILL_LEVEL_MIN,
    levelMax: USER_SKILL_LEVEL_MAX,
    // Legacy shape kept for existing consumers:
    boostSkills: skills.map((s) => s.name),
    exactSkills: [...ctx.exactSet],
    profileCompacts: ctx.profileCompacts || [],
    boostCompacts: ctx.profileCompacts || [],
    profileTokens: ctx.profileTokens || [],
    ctx,
  };
}

export async function getProfileMatchSkills(req, res) {
  try {
    const applierName = String(req.query?.applierName || '').trim();
    if (!applierName) {
      return res.status(400).json({ success: false, error: 'applierName query required' });
    }

    const { ctx: _ctx, ...payload } = await contextPayload(applierName);
    return res.json({ success: true, ...payload });
  } catch (err) {
    console.error('GET /api/personal/profile-match-skills error', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

export async function addProfileMatchSkill(req, res) {
  try {
    const applierName = String(req.body?.applierName || '').trim();
    const skill = String(req.body?.skill || '').trim();
    if (!applierName || !skill) {
      return res.status(400).json({ success: false, error: 'applierName and skill required' });
    }

    const result = await upsertUserSkill(applierName, {
      name: skill,
      category: req.body?.category,
      level: req.body?.level,
    });
    const { ctx, ...payload } = await contextPayload(applierName);

    const jobSkills = Array.isArray(req.body?.jobSkills)
      ? req.body.jobSkills.map((s) => String(s).trim()).filter(Boolean)
      : [];

    const skillHighlights = jobSkills.length ? computeSkillHighlights(jobSkills, ctx) : [];
    const coverage = jobSkills.length ? computeCoverageScore(jobSkills, ctx) : null;

    return res.json({
      success: true,
      added: true,
      ...payload,
      skillHighlights,
      skillsCovered: coverage?.covered.length ?? 0,
      skillsRequired: coverage?.required ?? 0,
      scoreSkill: coverage?.matchScore ?? 0,
      _skillsSaved: result.skills.length,
    });
  } catch (err) {
    console.error('POST /api/personal/profile-match-skills error', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

export async function removeProfileMatchSkill(req, res) {
  try {
    const applierName = String(req.body?.applierName ?? req.query?.applierName ?? '').trim();
    const skill = String(req.body?.skill ?? req.query?.skill ?? '').trim();
    if (!applierName || !skill) {
      return res.status(400).json({ success: false, error: 'applierName and skill required' });
    }

    const result = await removeUserSkill(applierName, skill);
    const { ctx: _ctx, ...payload } = await contextPayload(applierName);

    return res.json({
      success: true,
      removed: result.removed,
      ...payload,
    });
  } catch (err) {
    console.error('DELETE /api/personal/profile-match-skills error', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
