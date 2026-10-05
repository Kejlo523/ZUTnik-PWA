import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchUserPayments, PAYMENT_FIELDS } from './payments.mjs';
import { mapFinanceRecords } from './mappers.mjs';

test('requests only fields supported by ZUT payments API, once', async () => {
  const documented = new Set(['id', 'user', 'saldo_amount', 'chosen_installment_plan', 'who_chose_plan', 'date_of_plan_choice', 'available_installment_plans', 'type', 'description', 'state', 'account_number', 'payment_deadline', 'bonus_deadline', 'bonus_amount', 'has_bonus', 'interest', 'total_amount', 'currency', 'faculty', 'default_choice_date', 'debt_type']);
  let calls = 0;
  const data = await fetchUserPayments(async (method, options) => {
    calls++;
    assert.equal(method, 'services/payments/user_payments');
    assert.equal(options.tokenMode, 'required');
    assert.equal(options.token, 'test-token');
    assert.equal(options.secret, 'test-secret');
    assert.equal(options.params.fields, PAYMENT_FIELDS);
    for (const field of options.params.fields.split('|')) assert.ok(documented.has(field), `Unsupported field: ${field}`);
    return [{ id: 'fee', description: { pl: 'Legitymacja' }, total_amount: '22.00', saldo_amount: '22.00', state: 'unpaid', currency: 'PLN', payment_deadline: '2026-10-15', account_number: '1234' }];
  }, { token: 'test-token', secret: 'test-secret' });
  const [record] = mapFinanceRecords(data);
  assert.equal(calls, 1);
  assert.equal(record.title, 'Legitymacja');
  assert.equal(record.amountValue, 22);
  assert.equal(record.balanceValue, -22);
  assert.equal(record.paidValue, 0);
  assert.equal(record.dueDateText, '2026-10-15');
});

test('does not retry an upstream failure or replace it with empty payments', async () => {
  let calls = 0;
  const error = new Error('Upstream unavailable');
  await assert.rejects(fetchUserPayments(async () => { calls++; throw error; }, { token: 'test-token', secret: 'test-secret' }), (result) => result === error);
  assert.equal(calls, 1);
});
