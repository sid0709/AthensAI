import assert from 'node:assert/strict';
import { selectRelaySession, type DiscoverableRelaySession } from './session-selection.js';

const session = (id: string): DiscoverableRelaySession => ({
  profileId: 'profile-1',
  sessionId: id,
  peers: { controller: true, extension: false },
});

assert.equal(selectRelaySession('', [session('only')]), 'only');
assert.equal(selectRelaySession('', [session('one'), session('two')]), '');
assert.equal(selectRelaySession('two', [session('one'), session('two')]), 'two');
assert.equal(selectRelaySession('stale', []), '');
console.log('session-selection tests passed');
