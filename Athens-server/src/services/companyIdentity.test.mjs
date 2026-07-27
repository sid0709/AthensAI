import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCompanyIdentity,
  companyAliasId,
  companyIdFor,
  deriveCompanyIdentity,
  extractCompanyDomain,
  normalizeCompanyName,
  resolveCompanyIdentity,
} from './companyIdentity.js';

class MemoryCollection {
  constructor(rows = []) {
    this.rows = new Map(rows.map((row) => [String(row._id), structuredClone(row)]));
  }

  async findOne(filter) {
    return structuredClone(this.rows.get(String(filter._id)) || null);
  }

  async updateOne(filter, update, { upsert } = {}) {
    const id = String(filter._id);
    const existing = this.rows.get(id);
    if (!existing && !upsert) return { matchedCount: 0 };
    const next = existing ? { ...existing } : { _id: filter._id, ...(update.$setOnInsert || {}) };
    Object.assign(next, update.$set || {});
    this.rows.set(id, next);
    return { matchedCount: existing ? 1 : 0, upsertedCount: existing ? 0 : 1 };
  }
}

test('company names use conservative exact normalization', () => {
  assert.equal(normalizeCompanyName('  Acme, Inc.  '), 'acme inc');
  assert.equal(normalizeCompanyName('ACME & Sons'), 'acme and sons');
  assert.notEqual(normalizeCompanyName('Acme Inc'), normalizeCompanyName('Acme'));
  assert.equal(normalizeCompanyName('Unknown'), '');
});

test('company domains exclude shared recruiting and social hosts', () => {
  assert.equal(extractCompanyDomain('https://careers.acme.co.uk/jobs/1'), 'acme.co.uk');
  assert.equal(extractCompanyDomain('https://boards.greenhouse.io/acme/jobs/1'), null);
  assert.equal(extractCompanyDomain('https://www.linkedin.com/company/acme'), null);
});

test('deterministic identities group exact names but isolate unknown jobs', () => {
  assert.equal(companyIdFor('name', 'acme'), companyIdFor('name', 'acme'));
  const first = deriveCompanyIdentity({ _id: 'job-1', company: { name: '' } });
  const second = deriveCompanyIdentity({ _id: 'job-2', company: { name: '' } });
  assert.notEqual(first.companyId, second.companyId);
  assert.equal(first.companyIdentitySource, 'unknown');
});

test('trusted domain alias wins a conflicting exact-name alias', async () => {
  const domain = 'acme.com';
  const normalized = 'acme';
  const aliases = new MemoryCollection([
    { _id: companyAliasId('domain', domain), companyId: 'cmp_domain', kind: 'domain', normalizedValue: domain },
    { _id: companyAliasId('name', normalized), companyId: 'cmp_name', kind: 'name', normalizedValue: normalized },
  ]);
  const companies = new MemoryCollection();
  const identity = await resolveCompanyIdentity({
    company: { name: 'Acme' },
    companyLink: 'https://acme.com/careers',
  }, { companiesCollection: companies, companyAliasesCollection: aliases });

  assert.equal(identity.companyId, 'cmp_domain');
  assert.equal(identity.companyIdentitySource, 'domain');
  assert.equal(identity.companyIdentityConflict, true);
  const job = {};
  applyCompanyIdentity(job, identity);
  assert.equal(job.companyId, 'cmp_domain');
});
