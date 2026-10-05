// ZUT exposes the standard payment fields, not name/amount/status from other installations.
export const PAYMENT_FIELDS = 'id|saldo_amount|type|description|state|account_number|payment_deadline|total_amount|currency|debt_type';

export function fetchUserPayments(fetchJson, { token, secret }) {
  return fetchJson('services/payments/user_payments', {
    token,
    secret,
    tokenMode: 'required',
    params: { fields: PAYMENT_FIELDS },
  });
}
