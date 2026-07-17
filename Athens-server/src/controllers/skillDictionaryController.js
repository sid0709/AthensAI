import { searchDictionary, countCoveredSkills } from '../services/skillDictionary/skillDictionaryStore.js';

export async function getSkillDictionary(req, res) {
  try {
    const q = String(req.query?.q || '').trim();
    const mode = req.query?.mode === 'contains' ? 'contains' : 'prefix';
    const limit = Math.min(50, Math.max(1, parseInt(req.query?.limit, 10) || 20));
    const skills = await searchDictionary(q, { limit, mode });
    return res.json({ success: true, skills });
  } catch (err) {
    console.error('GET /api/personal/skill-dictionary error', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

/** How many distinct dictionary skills a typed skill covers (word-containment). */
export async function getSkillCoverage(req, res) {
  try {
    const skill = String(req.query?.skill || '').trim();
    if (!skill) return res.status(400).json({ success: false, error: 'skill query required' });
    const covered = await countCoveredSkills(skill);
    return res.json({ success: true, covered });
  } catch (err) {
    console.error('GET /api/personal/skill-dictionary/coverage error', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
