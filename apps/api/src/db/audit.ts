import { prisma } from './prisma.js';

/**
 * `audit_log` (002) — the human-readable activity feed S45 reads back.
 *
 * Shared rather than copied because two families of endpoint write it for the
 * same reason: settings (S24/S43) change what money the whole building is
 * charged, and link codes (S04/S44) hand someone access to a tenant's bills.
 * Both are questions asked after the fact or not at all.
 *
 * Deliberately generic. The histories that carry enforcement —
 * `invoice_status_history`, `meter_reading_corrections`, `room_type_changes` —
 * stay as their own tables; this is not a replacement for them.
 */
export async function recordAudit(
  entityType: string,
  entityId: string | null,
  action: string,
  detail: unknown,
  actorId: string,
) {
  await prisma.$executeRaw`
    INSERT INTO audit_log (entity_type, entity_id, action, detail, actor_id)
    VALUES (${entityType}, ${entityId}::uuid, ${action}, ${JSON.stringify(detail)}::jsonb, ${actorId}::uuid)`;
}
