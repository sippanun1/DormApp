'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Button, Card, Field, inputClass, readonlyClass } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { baht, thaiDate } from '@/lib/format';
import { checkIn, fetchBooking } from '@/lib/stays';

type Booking = Awaited<ReturnType<typeof fetchBooking>>['booking'];

const ID_TYPES = [
  ['thai_id', 'บัตรประชาชน'],
  ['passport', 'พาสปอร์ต'],
  ['driving_license', 'ใบขับขี่'],
] as const;

/**
 * S12 — guest registration (Hotel Act enforcement point).
 *
 * There is no skip button and no "register later" link, because the API writes
 * the guest_registrations row in the same transaction as the check-in
 * (ADR-011): a stay without a registration is not a state the database can
 * hold. This screen simply doesn't offer what the system cannot do.
 *
 * The record is append-only (ADR-006), so a typo here has no edit path — it is
 * fixed by cancelling and re-creating the booking. Worth knowing before typing.
 */
export default function CheckInPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [booking, setBooking] = useState<Booking | null>(null);
  const [nationality, setNationality] = useState('ไทย'); // defaults ไทย, the common case
  const [idType, setIdType] = useState<(typeof ID_TYPES)[number][0]>('thai_id');
  const [idNumber, setIdNumber] = useState('');
  const [address, setAddress] = useState('');
  const [keyDeposit, setKeyDeposit] = useState('200');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchBooking(id)
      .then((r) => setBooking(r.booking))
      .catch((e) => setError(errorMessage(e, 'โหลดการจองไม่สำเร็จ')));
  }, [id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await checkIn(id, {
        key_deposit: Number(keyDeposit || 0),
        guest_nationality: nationality.trim(),
        guest_id_type: idType,
        guest_id_number: idNumber.trim(),
        guest_address: address.trim(),
      });
      router.push(`/rooms?checked_in=${booking?.room_number ?? ''}`);
    } catch (err) {
      setError(errorMessage(err, 'เช็คอินไม่สำเร็จ'));
      setBusy(false);
    }
  }

  return (
    <AppShell screen="S12" title="ลงทะเบียนผู้เข้าพัก">
      <form onSubmit={submit} className="flex max-w-[760px] flex-col gap-3">
        <Card title={booking ? `ห้อง ${booking.room_number} · ${booking.tenant_name}` : 'กำลังโหลด…'}>
          {booking && (
            <div className="flex flex-wrap gap-6 text-sm text-text-muted">
              <span>
                {thaiDate(booking.check_in_date)} → {thaiDate(booking.check_out_date)}
              </span>
              <span className="money">{baht(booking.nightly_rate)} / คืน</span>
              <span>{booking.tenant_phone}</span>
            </div>
          )}
        </Card>

        <Card
          title="ข้อมูลตามกฎหมายโรงแรม"
          hint="บันทึกพร้อมการเช็คอินในรายการเดียว — ข้ามขั้นตอนนี้ไม่ได้ และแก้ไขภายหลังไม่ได้"
        >
          <div className="grid grid-cols-2 gap-4">
            <Field label="สัญชาติ" required>
              <input
                required
                className={inputClass}
                value={nationality}
                onChange={(e) => setNationality(e.target.value)}
              />
            </Field>

            <Field label="ประเภทเอกสาร" required>
              <select
                className={inputClass}
                value={idType}
                onChange={(e) => setIdType(e.target.value as typeof idType)}
              >
                {ID_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="เลขที่เอกสาร" required>
              <input
                required
                className={`${inputClass} money`}
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value)}
              />
            </Field>

            {/* Rule 5: มัดจำกุญแจ, the daily species of deposit. It is not
                เงินประกัน and the two are never summed anywhere. */}
            <Field label="มัดจำกุญแจ" hint="คืนเมื่อคืนกุญแจตอนเช็คเอาต์">
              <input
                type="number"
                min={0}
                className={`${inputClass} money`}
                value={keyDeposit}
                onChange={(e) => setKeyDeposit(e.target.value)}
              />
            </Field>

            <div className="col-span-2">
              <Field label="ที่อยู่" required>
                <textarea
                  required
                  rows={2}
                  className={inputClass}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </Field>
            </div>
          </div>

          <p className="mt-3 text-xs text-text-muted">
            ข้อมูลนี้เก็บตามกฎหมายโรงแรม และแก้ไขไม่ได้หลังบันทึก — หากพิมพ์ผิด ต้องยกเลิกการจองแล้วทำใหม่
          </p>
        </Card>

        {error && <Alert>{error}</Alert>}

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={busy || !booking}>
            เช็คอิน
          </Button>
          <output className={`${readonlyClass} text-xs`}>ไม่มีปุ่มข้าม — การเช็คอินต้องมีทะเบียนผู้เข้าพักเสมอ</output>
        </div>
      </form>
    </AppShell>
  );
}
