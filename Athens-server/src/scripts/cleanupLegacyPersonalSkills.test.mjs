import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMigrationTaggedSkillDocs } from './cleanupLegacyPersonalSkills.js';

function fakeDoc(id, data) {
  return { id, data: () => data };
}

test('cleanup selects only ownerless personal_info migration rows', () => {
  const migrated = fakeDoc('migrated', {
    applierName: 'David Lee',
    name: '.NET Core',
    migratedFrom: 'personal_info',
  });
  const manual = fakeDoc('manual', {
    applierName: 'David Lee',
    name: '.NET',
    source: 'manual',
  });
  const otherMigration = fakeDoc('other', {
    applierName: 'David Lee',
    name: 'React',
    migratedFrom: 'another_source',
  });

  assert.deepEqual(
    selectMigrationTaggedSkillDocs([migrated, manual, otherMigration]).map((doc) => doc.id),
    ['migrated'],
  );
});
