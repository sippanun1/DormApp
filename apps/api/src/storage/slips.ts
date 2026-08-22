import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { env } from '../env.js';
import { badRequest } from '../http/errors.js';

/**
 * Slip storage — §5's upload constraint.
 *
 * The bucket is PRIVATE and every read goes through a short-lived signed URL.
 * A payment slip carries a name, an amount and a bank account; a public bucket
 * would put all of that on a URL that leaks the moment it is pasted anywhere.
 */
const supabase = createClient(env.SUPABASE_URL, env.supabaseSecretKey, {
  auth: { persistSession: false },
});

/**
 * Types are decided by the file's own first bytes, never by the client's
 * Content-Type — that header is whatever the uploader chose to write. A .php
 * renamed .jpg announces image/jpeg and is not an image.
 */
const MAGIC: { ext: string; mime: string; bytes: number[] }[] = [
  { ext: 'jpg', mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { ext: 'png', mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: 'pdf', mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
];

export function sniff(buffer: Buffer): { ext: string; mime: string } {
  const match = MAGIC.find((m) => m.bytes.every((b, i) => buffer[i] === b));
  // E12: a field-level problem, fixable in place — say what is accepted.
  if (!match) throw badRequest('ไฟล์สลิปต้องเป็น JPG, PNG หรือ PDF เท่านั้น');
  return { ext: match.ext, mime: match.mime };
}

/**
 * A stored path is only ever one we produced — `YYYY/MM/<uuid>.<ext>`, inside
 * the bucket named by SLIP_BUCKET. The bucket is not repeated in the key: it is
 * already in the URL Supabase builds, and duplicating it reads as a bug.
 */
export function isStoredSlipPath(path: string): boolean {
  return /^\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|png|pdf)$/.test(path);
}

let bucketReady = false;

/**
 * Created on first use rather than by a setup step someone has to remember.
 * `createBucket` on an existing bucket returns a duplicate error, which is the
 * success case on every call after the first.
 */
async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const { error } = await supabase.storage.createBucket(env.SLIP_BUCKET, {
    public: false,
    fileSizeLimit: env.UPLOAD_MAX_SIZE,
  });
  if (error && !/exist/i.test(error.message)) throw error;
  bucketReady = true;
}

/**
 * Returns the storage path, not a URL. The path is unguessable (a UUID) and
 * useless without a signature, so it is safe to keep in the payments row.
 */
export async function storeSlip(buffer: Buffer): Promise<{ path: string; mime: string }> {
  const { ext, mime } = sniff(buffer);
  await ensureBucket();

  // bangkok_today() is the database's job; this is only a storage folder, and
  // the year/month here never reaches a bill.
  const now = new Date();
  const path = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(env.SLIP_BUCKET)
    .upload(path, buffer, { contentType: mime, upsert: false });
  if (error) throw error;

  return { path, mime };
}

/**
 * A signed URL for inline viewing (S22 shows the slip, it does not link to it).
 * Short-lived on purpose: the URL is the credential, so it should not outlive
 * the screen that asked for it.
 */
export async function signedSlipUrl(path: string, expiresInSeconds = 300): Promise<string | null> {
  if (!isStoredSlipPath(path)) return null;
  const { data, error } = await supabase.storage
    .from(env.SLIP_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}
