/* ── subscribe.js pure-logic tests ─────────────────────────────
   Run: node api/subscribe.test.js
   No network calls. No real contact data.
──────────────────────────────────────────────────────────────── */
import assert from 'node:assert/strict';
import { normalizeEmail, normalizePhone, classifyContact } from './subscribe.js';

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log('  PASS', label);
    passed++;
  } catch (e) {
    console.error('  FAIL', label);
    console.error('      ', e.message);
    failed++;
  }
}

/* ── Synthetic data (no real contacts) ──────────────────────── */
const PAST = [
  { email: 'alice@example.com', phone: '3125550001' },
  { email: 'bob@example.com',   phone: '3125550002' },
  { email: '',                  phone: '3125550003' }, /* phone-only record */
];

const SIGNUP_ONLY = [
  { emails: ['sandra@example.com', 'sandrab@example.com'], phone: '3125550099' },
];

/* ── normalizeEmail ──────────────────────────────────────────── */
console.log('\nnormalizeEmail');

test('trims whitespace and lowercases', () => {
  assert.equal(normalizeEmail('  Alice@Example.COM  '), 'alice@example.com');
});

test('returns empty string for empty input', () => {
  assert.equal(normalizeEmail(''), '');
  assert.equal(normalizeEmail(null), '');
});

test('does not strip dots or plus signs', () => {
  assert.equal(normalizeEmail('alice.bob+tag@example.com'), 'alice.bob+tag@example.com');
});

/* ── normalizePhone ──────────────────────────────────────────── */
console.log('\nnormalizePhone');

test('strips formatting and returns 10 digits', () => {
  assert.equal(normalizePhone('(312) 555-0001'), '3125550001');
  assert.equal(normalizePhone('312.555.0001'), '3125550001');
  assert.equal(normalizePhone('312-555-0001'), '3125550001');
});

test('strips leading 1 from 11-digit number', () => {
  assert.equal(normalizePhone('+13125550001'), '3125550001');
  assert.equal(normalizePhone('13125550001'), '3125550001');
});

test('returns null for 9-digit number', () => {
  assert.equal(normalizePhone('312555000'), null);
});

test('returns null for 12-digit number without leading 1', () => {
  assert.equal(normalizePhone('231255500011'), null);
});

test('returns null for empty input', () => {
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone(null), null);
});

test('returns null for letters-only input', () => {
  assert.equal(normalizePhone('call-me'), null);
});

/* ── classifyContact ─────────────────────────────────────────── */
console.log('\nclassifyContact');

test('returns unavailable when pastCustomers is null (missing/malformed JSON)', () => {
  assert.equal(classifyContact('alice@example.com', '3125550001', null, []), 'unavailable');
});

test('returns unavailable when pastCustomers is not an array', () => {
  assert.equal(classifyContact('alice@example.com', '3125550001', {}, []), 'unavailable');
});

test('matches by email → returning', () => {
  assert.equal(classifyContact('alice@example.com', '9990000000', PAST, SIGNUP_ONLY), 'returning');
});

test('matches by phone → returning', () => {
  assert.equal(classifyContact('unknown@example.com', '3125550002', PAST, SIGNUP_ONLY), 'returning');
});

test('email match is case-insensitive', () => {
  assert.equal(classifyContact('ALICE@EXAMPLE.COM', '9990000000', PAST, SIGNUP_ONLY), 'returning');
});

test('phone-only record in history matches by phone', () => {
  assert.equal(classifyContact('nobody@example.com', '3125550003', PAST, SIGNUP_ONLY), 'returning');
});

test('no match → new', () => {
  assert.equal(classifyContact('newguy@example.com', '3120000000', PAST, SIGNUP_ONLY), 'new');
});

test('signup-only email match → unavailable (not returning)', () => {
  assert.equal(classifyContact('sandra@example.com', '9990000000', PAST, SIGNUP_ONLY), 'unavailable');
});

test('signup-only secondary email match → unavailable', () => {
  assert.equal(classifyContact('sandrab@example.com', '9990000000', PAST, SIGNUP_ONLY), 'unavailable');
});

test('signup-only phone match → unavailable even when not in PAST', () => {
  assert.equal(classifyContact('nobody@example.com', '3125550099', PAST, SIGNUP_ONLY), 'unavailable');
});

test('null normPhone is handled without throwing', () => {
  /* normPhone=null means lookup by email only for phone-keyed records */
  assert.equal(classifyContact('alice@example.com', null, PAST, SIGNUP_ONLY), 'returning');
  assert.equal(classifyContact('newguy@example.com', null, PAST, SIGNUP_ONLY), 'new');
});

test('empty signupOnly array is safe', () => {
  assert.equal(classifyContact('alice@example.com', '9990000000', PAST, []), 'returning');
});

/* ── Summary ─────────────────────────────────────────────────── */
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
