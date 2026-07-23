import test from 'node:test';
import assert from 'node:assert/strict';
import { overallStatus } from './statusStore.js';

test('overall status prioritizes outages over degraded and unknown components', () => {
	assert.equal(overallStatus([{ status: 'operational' }, { status: 'unknown' }]), 'unknown');
	assert.equal(overallStatus([{ status: 'degraded' }, { status: 'unknown' }]), 'degraded');
	assert.equal(overallStatus([{ status: 'partial_outage' }, { status: 'degraded' }]), 'partial_outage');
	assert.equal(overallStatus([{ status: 'major_outage' }, { status: 'operational' }]), 'major_outage');
});

