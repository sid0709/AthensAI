/**
 * @deprecated Boost skills were replaced by the manual user_skills collection
 * (name + category + level). This shim keeps the old surface alive for any
 * stray importer; new code should use userSkillsService.js directly.
 */
import {
  listUserSkills,
  upsertUserSkill,
  removeUserSkill,
} from './userSkillsService.js';

export async function loadProfileBoostSkills(applierName) {
  const skills = await listUserSkills(applierName);
  return skills.map((s) => s.name);
}

export async function addProfileBoostSkill(applierName, skill) {
  const result = await upsertUserSkill(applierName, { name: skill });
  return { skills: result.skills.map((s) => s.name), added: true };
}

export async function removeProfileBoostSkill(applierName, skill) {
  const result = await removeUserSkill(applierName, skill);
  return { skills: result.skills.map((s) => s.name), removed: result.removed };
}
