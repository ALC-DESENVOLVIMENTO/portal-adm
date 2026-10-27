import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { webhookCredentials, validWebhookSignature, constantTimeTokenEqual } from './webhook-auth.js';

test('driver callback credentials do not use the ARCHI token when bridge credentials exist', () => {
  const env = { ACCESS_ADM_WEBHOOK_TOKEN: 'archi', PDFONLINE_BRIDGE_TOKEN: 'driver', ACCESS_ADM_WEBHOOK_SECRET: 'archi-sign', PDFONLINE_WEBHOOK_SECRET: 'driver-sign' };
  assert.deepEqual(webhookCredentials('pdfonline', env), { token: 'driver', secret: 'driver-sign' });
  assert.deepEqual(webhookCredentials('archi', env), { token: 'archi', secret: 'archi-sign' });
  const isolated = {...env, PDFONLINE_INVOICE_WEBHOOK_SECRET: 'invoice-sign'};
  assert.equal(webhookCredentials('pdfonline', isolated).secret, 'invoice-sign');
  assert.equal(webhookCredentials('archi', isolated).secret, 'archi-sign');
});

test('signature validates exact bytes and rejects altered content and another channel secret', () => {
  const body = Buffer.from('{ "event": "portal.invoice.created" }');
  const signature = createHmac('sha256', 'driver-sign').update(body).digest('hex');
  assert.equal(validWebhookSignature(body, signature, 'driver-sign'), true);
  assert.equal(validWebhookSignature(JSON.stringify(JSON.parse(body.toString())), signature, 'driver-sign'), false);
  assert.equal(validWebhookSignature(body, signature, 'archi-sign'), false);
  assert.equal(validWebhookSignature(body, '', 'driver-sign'), false);
  assert.equal(constantTimeTokenEqual('é', 'ab'), false);
});
