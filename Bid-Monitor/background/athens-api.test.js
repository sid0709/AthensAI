/**
 * Unit tests for AthensApi bidder authentication — run with: node background/athens-api.test.js
 */
const assert = require('assert');
const { AthensApi } = require('./athens-api.js');

async function withFetch(mock, test) {
  const originalFetch = global.fetch;
  global.fetch = mock;
  try {
    await test();
  } finally {
    global.fetch = originalFetch;
  }
}

async function testBidderSignInSuccess() {
  await withFetch(async (url, options) => {
    assert.strictEqual(url, 'http://127.0.0.1:8979/api/auth/bidder-signin');
    assert.strictEqual(options.method, 'POST');
    assert.deepStrictEqual(JSON.parse(options.body), {
      name: 'Oliver Baltay',
      password: 'vendor-secret',
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        user: { _id: 'account-1', name: 'Oliver Baltay' },
      }),
    };
  }, async () => {
    const result = await AthensApi.bidderSignIn('  Oliver Baltay  ', 'vendor-secret');
    assert.deepStrictEqual(result, {
      ok: true,
      user: { _id: 'account-1', name: 'Oliver Baltay' },
    });
  });
}

async function testBidderSignInPreservesServerError() {
  await withFetch(async () => ({
    ok: false,
    status: 403,
    json: async () => ({
      success: false,
      code: 'VENDOR_ACCESS_OFF',
      message: 'Vendor access is off for this profile.',
    }),
  }), async () => {
    const result = await AthensApi.bidderSignIn('Oliver Baltay', 'vendor-secret');
    assert.deepStrictEqual(result, {
      ok: false,
      code: 'VENDOR_ACCESS_OFF',
      error: 'Vendor access is off for this profile.',
    });
  });
}

async function testBidderSignInRequiresCredentials() {
  const result = await AthensApi.bidderSignIn('', '');
  assert.deepStrictEqual(result, {
    ok: false,
    code: 'MISSING_CREDENTIALS',
    error: 'Profile name and vendor access password are required.',
  });
}

async function run() {
  await testBidderSignInSuccess();
  await testBidderSignInPreservesServerError();
  await testBidderSignInRequiresCredentials();
  console.log('athens-api.test.js: all passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
