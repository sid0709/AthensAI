import { patternToRegex, matchesPattern } from '../src/matcher';

const cases: Array<[string, string, boolean]> = [
  ['?__index__', '2X6x__index__', true],
  ['?__index__', 'a__index__', true],
  ['?__index__', '__index__', true],
  ['?_id_?', 'weioj_id_aiofjio', true],
  ['?_id_?', 'weioj_id_', true],
  ['?_id_?', 'xid_y', false],
];

for (const [pattern, value, expected] of cases) {
  const actual = matchesPattern(value, pattern);
  if (actual !== expected) {
    console.error(`FAIL ${pattern} vs ${value}: expected ${expected}, got ${actual}`);
    process.exit(1);
  }
}

console.log('matcher ok:', patternToRegex('?__index__').source);
