import { ObjectId } from 'mongodb';
import { collections } from '../../db/collections';
import { notifyEmployee } from '../../services/notify';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function oid(v: any) {
  if (v instanceof ObjectId) return v;
  if (typeof v === 'string' && ObjectId.isValid(v)) return new ObjectId(v);
  return null;
}

export async function getPayrollPeriodConfig() {
  const setting = await collections.settings().findOne({ key: 'payroll_period' });
  return (setting?.value as { startDay?: number; endDay?: number } | undefined) || null;
}

export async function notifySlipFinalized(slip: any, monthName: string, year: number) {
  if (!slip.employee) return;
  const empId = slip.employee._id || slip.employee;
  await notifyEmployee(empId, {
    title: 'Salary Slip Ready',
    body: `Your salary slip for ${monthName} ${year} has been finalized. Net Pay: ₹${(slip.netPay || 0).toLocaleString('en-IN')}`,
    type: 'info',
    link: '/payroll',
  }).catch((e) => console.warn('Salary slip notify failed:', (e as Error).message));
}
