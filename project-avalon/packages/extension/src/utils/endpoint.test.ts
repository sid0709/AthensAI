import { relayHttpBase, relaySocketOrigin } from './endpoint.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function assertEq(actual: string, expected: string, label: string): void {
  assert(actual === expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function runTests() {
  // Local direct relay (no /avalon path)
  assertEq(relaySocketOrigin('http://127.0.0.1:3847'), 'http://127.0.0.1:3847', 'local relay');
  assertEq(relayHttpBase('http://127.0.0.1:3847'), 'http://127.0.0.1:3847/avalon', 'local http base');

  // VPS / Docker origin (correct build-time form)
  assertEq(relaySocketOrigin('http://83.229.67.146:9030'), 'http://83.229.67.146:9030', 'vps origin');
  assertEq(
    relayHttpBase('http://83.229.67.146:9030'),
    'http://83.229.67.146:9030/avalon',
    'vps http base',
  );

  // Legacy VPS form that caused "Invalid namespace"
  assertEq(
    relaySocketOrigin('https://sid.remotepairnet.net/avalon'),
    'https://sid.remotepairnet.net',
    'legacy /avalon',
  );
  assertEq(
    relayHttpBase('https://sid.remotepairnet.net/avalon'),
    'https://sid.remotepairnet.net/avalon',
    'legacy http base',
  );

  // Trailing slashes
  assertEq(relaySocketOrigin('https://host.example/avalon/'), 'https://host.example', 'trailing slash /avalon/');
  assertEq(relaySocketOrigin('https://host.example:9030/'), 'https://host.example:9030', 'trailing slash origin');
  assertEq(
    relayHttpBase('https://host.example:9030/'),
    'https://host.example:9030/avalon',
    'trailing slash http base',
  );

  // Protocol + non-default port preserved
  assertEq(relaySocketOrigin('http://example.com:8080/avalon'), 'http://example.com:8080', 'http + port');
  assertEq(relaySocketOrigin('https://example.com:8443/avalon'), 'https://example.com:8443', 'https + port');

  // Default ports collapse correctly via URL.origin
  assertEq(relaySocketOrigin('https://example.com:443/avalon'), 'https://example.com', 'https default port');
  assertEq(relaySocketOrigin('http://example.com:80/avalon'), 'http://example.com', 'http default port');

  // Empty / whitespace
  assertEq(relaySocketOrigin(''), '', 'empty');
  assertEq(relaySocketOrigin('   '), '', 'whitespace');

  console.log('endpoint.test.ts: all passed');
}

runTests();
