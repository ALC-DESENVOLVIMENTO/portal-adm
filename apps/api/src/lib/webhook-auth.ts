import { createHmac, timingSafeEqual } from 'node:crypto';

export type WebhookChannel = 'archi' | 'pdfonline';

export function webhookCredentials(channel: WebhookChannel, env = process.env) {
  return channel === 'pdfonline'
    ? {
        token: String(env.PDFONLINE_WEBHOOK_TOKEN || env.PDFONLINE_BRIDGE_TOKEN || env.ACCESS_ADM_WEBHOOK_TOKEN || '').trim(),
        secret: String(env.PDFONLINE_INVOICE_WEBHOOK_SECRET || env.PDFONLINE_WEBHOOK_SECRET || env.ACCESS_ADM_WEBHOOK_SECRET || '').trim()
      }
    : {
        token: String(env.ACCESS_ADM_WEBHOOK_TOKEN || env.PDFONLINE_BRIDGE_TOKEN || env.PDFONLINE_WEBHOOK_TOKEN || '').trim(),
        secret: String(env.ACCESS_ADM_WEBHOOK_SECRET || env.PDFONLINE_WEBHOOK_SECRET || '').trim()
      };
}

export function constantTimeTokenEqual(provided: string, expected: string) {
  const actualBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function validWebhookSignature(body: Buffer | string, signature: string, secret: string) {
  if (!secret) return true;
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  const provided = signature.trim().replace(/^sha256=/i, '');
  return constantTimeTokenEqual(provided, expected);
}
