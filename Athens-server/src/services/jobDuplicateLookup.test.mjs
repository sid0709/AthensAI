import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findDuplicateByContent,
  findDuplicateByUrl,
  newestDuplicate,
} from './jobDuplicateLookup.js';

function fakeCollection(results) {
  const calls = [];
  return {
    calls,
    find(filter, options) {
      calls.push({ filter, options });
      const field = Object.hasOwn(filter, 'applyLink') ? 'applyLink'
        : Object.hasOwn(filter, 'url') ? 'url'
          : 'title';
      return { toArray: async () => results[field] || [] };
    },
  };
}

test('URL duplicate lookup uses separate indexed queries and keeps the newest match', async () => {
  const collection = fakeCollection({
    applyLink: [{ _id: 'old', postedAt: '2026-01-01T00:00:00Z' }],
    url: [{ _id: 'new', postedAt: '2026-02-01T00:00:00Z' }],
  });
  const duplicate = await findDuplicateByUrl(collection, ['https://example.com/job'], { extensionV2: false });
  assert.equal(duplicate._id, 'new');
  assert.equal(collection.calls.length, 2);
  assert.equal(collection.calls.some(({ filter }) => Object.hasOwn(filter, '$or')), false);
  assert.equal(collection.calls.every(({ options }) => options.sort === undefined), true);
});

test('content duplicate lookup bounds by title and compares company and JD locally', async () => {
  const collection = fakeCollection({
    title: [
      { _id: 'wrong-company', company: { name: 'Other' }, description: 'Same JD' },
      { _id: 'match', company: { name: 'Athens' }, description: 'Same JD' },
    ],
  });
  const duplicate = await findDuplicateByContent(collection, {
    title: 'Engineer',
    companyName: 'Athens',
    description: 'Same JD',
  });
  assert.equal(duplicate._id, 'match');
  assert.deepEqual(collection.calls[0].filter, { title: 'Engineer' });
});

test('newest duplicate uses deterministic timestamps', () => {
  assert.equal(newestDuplicate([
    { _id: 'a', createdAt: '2026-01-01T00:00:00Z' },
    { _id: 'b', _createdAt: '2026-03-01T00:00:00Z' },
  ])._id, 'b');
});
