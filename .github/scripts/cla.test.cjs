const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AGREEMENT, evaluate } = require('./cla.cjs');
const pr = { user: { login: 'alice' } };
const commit = (login, message = 'Fix') => ({ author: login ? { login } : null, commit: { message } });
const signature = login => ({ user: { login, type: 'User' }, body: AGREEMENT });

test('requires explicit agreement by each author, not a checkbox or quoted text', () => {
  assert.equal(evaluate(pr, [], [commit('alice')]).state, 'pending');
  assert.equal(evaluate(pr, [{ ...signature('alice'), body: `> ${AGREEMENT}` }], [commit('alice')]).state, 'pending');
  assert.equal(evaluate(pr, [signature('bob')], [commit('alice')]).state, 'pending');
  assert.equal(evaluate(pr, [signature('alice')], [commit('alice')]).state, 'success');
  assert.equal(evaluate(pr, [signature('alice')], [commit('alice'), commit('bob')]).state, 'pending');
  assert.equal(evaluate(pr, [signature('alice'), signature('bob')], [commit('alice'), commit('bob')]).state, 'success');
});
test('removal or bot signature does not satisfy agreement', () => {
  assert.equal(evaluate(pr, [{ ...signature('alice'), user: { login: 'alice', type: 'Bot' } }], []).state, 'pending');
  assert.equal(evaluate(pr, [], []).state, 'pending');
});
test('checks coauthors and fails closed on unresolved author identities', () => {
  assert.equal(evaluate(pr, [signature('alice')], [commit(null)]).state, 'pending');
  assert.equal(evaluate(pr, [signature('alice')], [commit('alice', 'Fix\n\nCo-authored-by: Bob <42+bob@users.noreply.github.com>')]).state, 'pending');
  assert.equal(evaluate(pr, [signature('alice'), signature('bob')], [commit('alice', 'Fix\n\nCo-authored-by: Bob <42+bob@users.noreply.github.com>')]).state, 'success');
  assert.equal(evaluate(pr, [signature('alice')], [commit('alice', 'Co-authored-by: Bob <bob@example.com>')]).state, 'pending');
});
test('licensor does not grant a license to himself', () => {
  assert.equal(evaluate({ user: { login: 'luozhang1024' } }, [], [commit('luozhang1024')]).state, 'success');
});
