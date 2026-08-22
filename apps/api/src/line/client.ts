import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';

/**
 * The LINE Messaging API, over global fetch — no new dependency (Node 18+).
 *
 * Same shape as `storage/slips.ts`: module-scope config, lazy, env-driven, and
 * nothing here knows what a notification is. This file moves bytes; what may be
 * in them is `line/messages.ts`, and whether to send is `line/sender.ts`.
 *
 * ADR-018 is obsolete — LINE Notify was discontinued on 31 March 2025 and this
 * is the Messaging API that replaced it (docs/LINE_INTEGRATION_PLAN.md).
 */
const PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const REPLY_URL = 'https://api.line.me/v2/bot/message/reply';

/** LINE's own cap on a text message. Longer is rejected by the API, not truncated. */
const MAX_TEXT = 5000;

export class LineError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function post(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // LINE answers with {message, details[]}. Kept short: this ends up in
    // `notifications.line_error`, which a person reads on a screen.
    const detail = await res.text().catch(() => '');
    throw new LineError(res.status, `LINE ${res.status}: ${detail.slice(0, 300)}`);
  }
}

/**
 * A push to one tenant. Counts against the free tier's monthly quota — the
 * caller is responsible for the count, because whether a message is worth one
 * of 300 is not a transport decision.
 *
 * In dry-run the message is logged and nothing leaves the process. Dry-run is
 * the default outside production: a smoke run must never reach a real phone.
 */
export async function pushMessage(lineUserId: string, text: string): Promise<void> {
  if (!env.lineConfigured) throw new LineError(503, 'LINE is not configured on this service');
  if (env.lineDryRun) {
    console.log(`[line:dry-run] push → ${lineUserId}\n${text}`);
    return;
  }
  await post(PUSH_URL, { to: lineUserId, messages: [{ type: 'text', text: text.slice(0, MAX_TEXT) }] });
}

/**
 * A reply to something the tenant sent. **Free** — replies do not count against
 * the 300/month push quota, which is why binding a link code happens in the
 * chat rather than by pushing a confirmation.
 *
 * A reply token is single-use and expires; a failure here is logged and
 * swallowed by the caller, because LINE has already had its 200 by then.
 */
export async function replyMessage(replyToken: string, text: string): Promise<void> {
  if (!env.lineConfigured) throw new LineError(503, 'LINE is not configured on this service');
  if (env.lineDryRun) {
    console.log(`[line:dry-run] reply → ${replyToken}\n${text}`);
    return;
  }
  await post(REPLY_URL, { replyToken, messages: [{ type: 'text', text: text.slice(0, MAX_TEXT) }] });
}

/**
 * `X-Line-Signature`: HMAC-SHA256 of the **raw** body with the channel secret.
 *
 * Raw, not re-serialised — `JSON.stringify(req.body)` is a different byte
 * sequence from what LINE signed as soon as a key order or an escape differs,
 * and the check would fail for every real request while passing none. The body
 * is captured by `express.json({ verify })` in index.ts.
 *
 * `timingSafeEqual` on equal-length buffers only: it throws on a length
 * mismatch, and a wrong-length signature is simply invalid.
 */
export function verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature || !env.LINE_CHANNEL_SECRET) return false;
  const expected = createHmac('sha256', env.LINE_CHANNEL_SECRET).update(rawBody).digest();
  const given = Buffer.from(signature, 'base64');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
