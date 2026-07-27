import test from 'node:test';
import assert from 'node:assert/strict';
import { agentControllerTest } from './agentController.js';

test('manual job URLs are canonicalized and tracking fragments are removed', () => {
  assert.equal(
    agentControllerTest.canonicalJobUrl('https://jobs.example.com/role?utm_source=test&id=42#apply'),
    'https://jobs.example.com/role?id=42',
  );
  assert.throws(() => agentControllerTest.canonicalJobUrl('javascript:alert(1)'), /http or https/);
});

test('manual job descriptions strip markup, scripts, and control characters', () => {
  const result = agentControllerTest.sanitizedJobDescription(
    '<style>secret-style</style><script>secret-script</script><p>Build systems\u0000 safely.</p>',
  );
  assert.equal(result, 'Build systems safely.');
});
