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

async function testMailApiUsesProfileCredentials() {
  const requests = [];
  await withFetch(async (url, options) => {
    requests.push({ url, options });
    if (url.includes('/mail/credentials')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, configured: true, email: 'bidder@gmail.com' }),
      };
    }
    if (url.includes('/mail/messages/42')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, thread: { id: '42', subj: 'Interview' } }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        threads: [{ id: '42', subj: 'Interview' }],
        total: 1,
        page: 2,
        pageSize: 20,
      }),
    };
  }, async () => {
    const credentials = await AthensApi.checkMailCredentials('  Oliver Baltay  ');
    assert.strictEqual(credentials.configured, true);

    const list = await AthensApi.fetchMailThreads('Oliver Baltay', {
      folder: 'sent',
      label: 'Notify/Unnecessary',
      page: 2,
      pageSize: 20,
      force: true,
    });
    assert.strictEqual(list.threads[0].id, '42');

    const message = await AthensApi.fetchMailMessage('Oliver Baltay', 42, 'sent');
    assert.strictEqual(message.thread.subj, 'Interview');
  });

  assert.strictEqual(
    requests[0].url,
    'http://127.0.0.1:8979/api/mail/credentials?applierName=Oliver%20Baltay',
  );
  assert.strictEqual(
    requests[1].url,
    'http://127.0.0.1:8979/api/mail/threads?applierName=Oliver+Baltay&folder=sent&page=2&pageSize=20&label=Notify%2FUnnecessary&force=true',
  );
  assert.strictEqual(
    requests[2].url,
    'http://127.0.0.1:8979/api/mail/messages/42?applierName=Oliver+Baltay&folder=sent',
  );
}

async function run() {
  await testBidderSignInSuccess();
  await testBidderSignInPreservesServerError();
  await testBidderSignInRequiresCredentials();
  await testMailApiUsesProfileCredentials();
  console.log('athens-api.test.js: all passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
