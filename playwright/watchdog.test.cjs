const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ActivityDeadline } = require('./watchdog.cjs');

test('restarts only at three minutes of unchanged foreground content', () => {
  const d = new ActivityDeadline(180000, 0);
  d.observe('tab1:header1', 1000);
  d.observe('tab1:header1', 100000);
  assert.equal(d.expired(180999), false);
  assert.equal(d.expired(181000), true);
});
test('ticket/header and foreground-tab changes renew the deadline', () => {
  const d = new ActivityDeadline(180000, 0);
  d.observe('tab1:ticket1', 0);
  d.observe('tab1:ticket2', 170000);
  assert.equal(d.expired(180000), false);
  d.observe('tab2:ticket2', 340000);
  assert.equal(d.expired(519999), false);
  assert.equal(d.expired(520000), true);
});
test('failed or missing page evaluations never renew the deadline', () => {
  const d = new ActivityDeadline(180000, 0);
  d.observe(null, 90000);
  d.observe(undefined, 179000);
  assert.equal(d.expired(180000), true);
});
