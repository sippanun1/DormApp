import { Router, type Request } from 'express';
import { prisma } from '../db/prisma.js';
import { env } from '../env.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { replyMessage, verifySignature } from '../line/client.js';
import {
  claimLinkCode,
  LineAccountTakenError,
  looksLikeCode,
  TenantAlreadyBoundError,
} from '../tenant/link-codes.js';

/**
 * The LINE webhook — Phase 3 of docs/LINE_INTEGRATION_PLAN.md.
 *
 * This is where a tenant's LINE account gets bound to their tenancy: they send
 * the same six-character code the office already gives them, and the reply is
 * free, so binding never spends one of the 300 monthly pushes.
 *
 * It is NOT authentication. A LINE account cannot become a session, cannot read
 * a bill and cannot reach anything under `/tenant/*` — the owner's 2026-08-21
 * decision keeps LINE a notification channel, not a door. The identity proof is
 * still the code, which is why the claim below is the same function the browser
 * calls.
 *
 * Unauthenticated by necessity — LINE has no bearer token to present — so the
 * signature IS the authentication, and every path returns 200 to LINE once the
 * signature holds. LINE retries anything else, and a retry of an event that was
 * already handled is worse than a silent no-op.
 */
export const lineRoutes = Router();

/** `express.json({ verify })` in index.ts stashes the untouched bytes here. */
type RawBodyRequest = Request & { rawBody?: Buffer };

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type: string; text?: string };
}

/** Sent when a code binds. Says which tenant, so a mistyped bind is obvious immediately. */
const BOUND = (name: string) =>
  `เชื่อมบัญชีเรียบร้อยแล้วค่ะ คุณ${name}\nจะได้รับแจ้งเตือนบิลและกำหนดชำระทาง LINE ตั้งแต่นี้เป็นต้นไป`;

/**
 * One message for wrong, expired and already-used alike — the same wording the
 * app uses. Telling them apart tells someone guessing which guesses were real.
 */
const BAD_CODE = 'รหัสไม่ถูกต้องหรือหมดอายุแล้ว — ขอรหัสใหม่จากสำนักงานได้เลยค่ะ';

const ALREADY_LINKED = 'บัญชี LINE นี้เชื่อมกับผู้เช่ารายอื่นอยู่แล้วค่ะ กรุณาติดต่อสำนักงาน';

/**
 * The mirror case, and the one migration 011 created: the code is valid but the
 * tenant already has a different LINE account bound.
 *
 * While a code stays live, anyone holding the slip could otherwise send it from
 * their own LINE and quietly take over where that tenant's bill notices go. The
 * bind is first-wins, so this is a refusal rather than a hand-over, and
 * changing accounts needs a new code from the desk — which is a person who can
 * see who is asking.
 */
const TENANT_HAS_LINE =
  'ผู้เช่ารายนี้เชื่อมกับบัญชี LINE อื่นอยู่แล้วค่ะ\nหากต้องการเปลี่ยนบัญชี กรุณาขอรหัสใหม่จากสำนักงาน';

/**
 * Anything that is not a code. Deliberately answered rather than ignored: a
 * tenant typing a question into the chat should not be met with silence, and
 * the office does not watch this inbox — S42 is where a request becomes a
 * record (rule 14's shape: no chat queue).
 */
const NOT_A_CODE =
  'สำนักงานไม่ได้ตอบข้อความในแชทนี้ค่ะ\n' +
  '• เชื่อมบัญชี: ส่งรหัส 6 หลักที่ได้รับจากสำนักงาน\n' +
  '• ดูบิล/แจ้งชำระเงิน/แจ้งซ่อม: เปิดแอปของหอพัก\n' +
  '• เรื่องด่วน: ติดต่อสำนักงานโดยตรง';

/** A reply is best-effort: LINE already has its 200, and a reply token is single-use. */
async function reply(token: string | undefined, text: string): Promise<void> {
  if (!token) return;
  try {
    await replyMessage(token, text);
  } catch (err) {
    console.error('[line:reply]', err);
  }
}

async function handleMessage(event: LineEvent): Promise<void> {
  const text = event.message?.text?.trim();
  const lineUserId = event.source?.userId;
  if (!text || !lineUserId) return;

  if (!looksLikeCode(text)) {
    await reply(event.replyToken, NOT_A_CODE);
    return;
  }

  try {
    const claimed = await claimLinkCode(text, lineUserId);
    await reply(event.replyToken, claimed ? BOUND(claimed.full_name) : BAD_CODE);
  } catch (err) {
    if (err instanceof LineAccountTakenError) {
      await reply(event.replyToken, ALREADY_LINKED);
      return;
    }
    if (err instanceof TenantAlreadyBoundError) {
      await reply(event.replyToken, TENANT_HAS_LINE);
      return;
    }
    console.error('[line:webhook]', err);
    await reply(event.replyToken, 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งค่ะ');
  }
}

/**
 * They blocked or removed the account. The binding goes, so the sender stops
 * spending quota on a phone that will not receive it and marks those rows
 * `skipped` instead.
 *
 * The notifications themselves are untouched — Rule 6.13's proof is the in-app
 * record, and it outlives the LINE copy by design (009 makes the row immutable).
 */
async function handleUnfollow(event: LineEvent): Promise<void> {
  const lineUserId = event.source?.userId;
  if (!lineUserId) return;
  await prisma.$executeRaw`
    UPDATE tenants SET line_user_id = NULL WHERE line_user_id = ${lineUserId}`;
}

lineRoutes.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    // Not configured is not "forbidden": it is this service having nothing to
    // verify against, which the owner fixes in Railway, not in LINE.
    if (!env.lineConfigured) {
      res.status(503).json({ error: 'LINE is not configured on this service' });
      return;
    }

    const raw = (req as RawBodyRequest).rawBody;
    if (!raw || !verifySignature(raw, req.header('x-line-signature'))) {
      // 403 with no detail. Anyone who can reach this URL can guess why.
      res.status(403).json({ error: 'invalid signature' });
      return;
    }

    // Answer LINE first, work afterwards: LINE times out in seconds and retries
    // what it does not get a 200 for, and a retried bind is a second attempt on
    // a code that the first attempt already spent.
    res.status(200).json({ ok: true });

    const events = (req.body?.events ?? []) as LineEvent[];
    for (const event of events) {
      try {
        if (event.type === 'message' && event.message?.type === 'text') await handleMessage(event);
        // `follow` gets no reply: the Official Account's greeting message
        // already says what to do, and two messages on adding a friend reads as
        // a system talking to itself.
        else if (event.type === 'unfollow') await handleUnfollow(event);
      } catch (err) {
        console.error('[line:webhook]', err);
      }
    }
  }),
);
