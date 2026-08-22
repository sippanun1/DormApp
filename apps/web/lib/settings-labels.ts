/**
 * The owner's policies, named once.
 *
 * S43 renders these as an editable list; S45 reads the same keys back out of
 * the audit log. They live here rather than on S43 because an audit row that
 * says "7 → 5" without naming the setting is not a record of anything.
 */
export const SETTING_LABELS: Record<string, { label: string; effect: string; unit?: 'money' | 'day' }> = {
  bill_issue_day: { label: 'วันที่ออกบิลประจำเดือน', effect: 'ใช้เตือนให้ออกบิล — ไม่ได้ออกบิลอัตโนมัติ', unit: 'day' },
  due_day: {
    label: 'วันครบกำหนดชำระ',
    effect: 'ใช้กับบิลที่ออกหลังจากนี้เท่านั้น — บิลที่ออกไปแล้วเก็บวันครบกำหนดของตัวเองไว้',
    unit: 'day',
  },
  due_reminder_days: { label: 'แจ้งเตือนก่อนครบกำหนด', effect: 'จำนวนวันก่อนถึงกำหนด' },
  grace_days: { label: 'ผ่อนผันก่อนคิดค่าปรับ', effect: 'ค่าปรับเริ่มนับหลังพ้นวันครบกำหนด' },
  late_fee_per_day: {
    label: 'ค่าปรับล่าช้า / วัน',
    effect: 'มีผลทันทีกับบิลที่ยังไม่ชำระ — บิลที่ส่งสลิปแล้วถูกล็อกค่าปรับไว้ ไม่เปลี่ยนตาม',
    unit: 'money',
  },
  deposit_months: { label: 'เงินประกัน (กี่เดือน)', effect: 'ใช้เป็นค่าตั้งต้นตอนทำสัญญาใหม่' },
  key_deposit: { label: 'มัดจำกุญแจ (รายวัน)', effect: 'ค่าตั้งต้นตอนเช็คอินรายวัน', unit: 'money' },
  cleaning_fee: { label: 'ค่าทำความสะอาด', effect: 'ใช้ตอนคิดยอดย้ายออก', unit: 'money' },
  renewal_notice_days: { label: 'แจ้งต่อสัญญาล่วงหน้า', effect: 'ใช้กับรายการสัญญาใกล้ครบกำหนดบนหน้างานวันนี้' },
  tenant_link_code_days: {
    label: 'อายุรหัสเชื่อมบัญชีผู้เช่า',
    effect: 'รหัสเดียวใช้ได้ทั้งแอปและ LINE ทุกเครื่อง — ไม่เกินวันสิ้นสุดสัญญา ไม่ว่าตั้งไว้กี่วัน',
  },
};
