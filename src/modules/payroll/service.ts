import { ObjectId } from 'mongodb';
import { collections } from '../../db/collections';

// ─── Validation ───────────────────────────────────────────────────────────────

export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const DIGITS_ONLY = /^\d+$/;

export function validateConfig(input: any) {
  const errors: Record<string, string> = {};
  const out: Record<string, any> = {};

  if (input.annualCTC !== undefined) {
    const v = Number(input.annualCTC);
    if (!Number.isFinite(v) || v < 12000) errors.annualCTC = 'Annual CTC must be at least ₹12,000';
    else if (v > 99999999) errors.annualCTC = 'Annual CTC must be at most ₹99,999,999 (8 digits)';
    else out.annualCTC = v;
  }
  if (input.basicPercent !== undefined) {
    const v = Number(input.basicPercent);
    if (!Number.isInteger(v) || v < 1 || v > 80) errors.basicPercent = 'Basic % must be 1–80';
    else out.basicPercent = v;
  }
  if (input.daAmount !== undefined) {
    const v = Number(input.daAmount);
    if (!Number.isFinite(v) || v < 0) errors.daAmount = 'DA amount must be ≥ 0';
    else if (v > 99999999) errors.daAmount = 'DA amount must be at most ₹99,999,999';
    else out.daAmount = v;
  }
  if (input.specialAllowance !== undefined) {
    const v = Number(input.specialAllowance);
    if (!Number.isFinite(v) || v < 0) errors.specialAllowance = 'Special Allowance must be ≥ 0';
    else if (v > 99999999) errors.specialAllowance = 'Special Allowance must be at most ₹99,999,999';
    else out.specialAllowance = v;
  }
  if (input.bankAccountName !== undefined) {
    const v = String(input.bankAccountName).trim();
    if (v && !/^[A-Za-z .'-]{2,100}$/.test(v)) errors.bankAccountName = "Use letters, spaces, dots only (2–100 chars)";
    else if (v.length > 100) errors.bankAccountName = 'Max 100 characters';
    else out.bankAccountName = v;
  }
  if (input.bankAccountNo !== undefined) {
    const v = String(input.bankAccountNo).replace(/\s+/g, '');
    if (v && (!DIGITS_ONLY.test(v) || v.length < 9 || v.length > 18)) errors.bankAccountNo = 'Account number must be 9–18 digits';
    else out.bankAccountNo = v;
  }
  if (input.bankName !== undefined) {
    const v = String(input.bankName).trim();
    if (v && (v.length < 2 || v.length > 100)) errors.bankName = 'Bank name must be 2–100 characters';
    else out.bankName = v;
  }
  if (input.ifscCode !== undefined) {
    const v = String(input.ifscCode).trim().toUpperCase();
    if (v && !IFSC_RE.test(v)) errors.ifscCode = 'IFSC must look like SBIN0001786';
    else out.ifscCode = v;
  }
  if (input.bankAddress !== undefined) {
    const v = String(input.bankAddress).trim();
    if (v.length > 200) errors.bankAddress = 'Max 200 characters';
    else out.bankAddress = v;
  }
  if (input.epfNo !== undefined) {
    const v = String(input.epfNo).replace(/\s+/g, '');
    if (v && (!DIGITS_ONLY.test(v) || v.length !== 12)) errors.epfNo = 'EPF UAN must be exactly 12 digits';
    else out.epfNo = v;
  }
  if (input.esiNo !== undefined) {
    const v = String(input.esiNo).trim();
    if (v && v.toUpperCase() !== 'NA' && (!DIGITS_ONLY.test(v) || v.length !== 17)) {
      errors.esiNo = 'ESI must be 17 digits, or "NA"';
    } else {
      out.esiNo = v;
    }
  }
  if (input.enableEPF !== undefined) out.enableEPF = Boolean(input.enableEPF);
  if (input.enableESI !== undefined) out.enableESI = Boolean(input.enableESI);

  if (out.enableEPF) {
    const epf = String(input.epfNo || '').replace(/\s+/g, '');
    if (!epf || !DIGITS_ONLY.test(epf) || epf.length !== 12) errors.epfNo = '12-digit UAN required when EPF is enabled';
    else out.epfNo = epf;
  }
  if (out.enableESI) {
    const esi = String(input.esiNo || '').trim().toUpperCase();
    if (!esi || (esi !== 'NA' && (!DIGITS_ONLY.test(esi) || esi.length !== 17))) errors.esiNo = '17-digit ESI or "NA" required when ESI is enabled';
    else out.esiNo = esi;
  }

  return { errors, clean: out };
}

// ─── Period / day helpers ─────────────────────────────────────────────────────

export function getSalaryPeriod(month: number, year: number, config?: { startDay?: number; endDay?: number } | null) {
  const sd = config?.startDay ?? 21;
  const ed = config?.endDay ?? 20;
  if (ed >= sd) {
    return { periodFrom: new Date(year, month - 1, sd), periodTo: new Date(year, month - 1, ed) };
  }
  return { periodFrom: new Date(year, month - 2, sd), periodTo: new Date(year, month - 1, ed) };
}

export function roundTwo(n: number) {
  return Math.round(n * 100) / 100;
}

export function daysInMonthOf(date: Date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

export async function getWorkingDaysList(periodFrom: Date, periodTo: Date) {
  const holidays = await collections.holidays().find({ date: { $gte: periodFrom, $lte: periodTo } }).toArray();
  const holidayDates = new Set(holidays.map(h => {
    const d = new Date(h.date);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }));

  const days: Date[] = [];
  const cursor = new Date(periodFrom);
  while (cursor <= periodTo) {
    const day = cursor.getDay();
    const key = `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`;
    if (day !== 0 && !holidayDates.has(key)) days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export async function calcWorkingDays(periodFrom: Date, periodTo: Date) {
  return (await getWorkingDaysList(periodFrom, periodTo)).length;
}

export async function calcPresentDays(employeeId: ObjectId, periodFrom: Date, periodTo: Date, preFillPresent = false, workingDaysList: Date[] = []) {
  if (!preFillPresent) {
    const records = await collections.attendances().find({
      employee: employeeId,
      date: { $gte: periodFrom, $lte: periodTo },
      status: { $in: ['present', 'half_day', 'work_from_home'] } as any,
    }).toArray();
    let count = 0;
    for (const r of records) count += r.status === 'half_day' ? 0.5 : 1;
    return count;
  }

  const records = await collections.attendances().find({
    employee: employeeId,
    date: { $gte: periodFrom, $lte: periodTo },
  }).toArray();
  const attMap = new Map<string, string | undefined>();
  for (const r of records) {
    const d = new Date(r.date);
    attMap.set(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`, r.status);
  }
  let count = 0;
  for (const wd of workingDaysList) {
    const key = `${wd.getFullYear()}-${wd.getMonth()}-${wd.getDate()}`;
    if (!attMap.has(key)) count += 1;
    else {
      const status = attMap.get(key);
      if (status === 'present' || status === 'work_from_home') count += 1;
      else if (status === 'half_day') count += 0.5;
    }
  }
  return count;
}

export async function calcApprovedLeaveDays(employeeId: ObjectId, periodFrom: Date, periodTo: Date) {
  const leaves = await collections.leaveRequests().find({
    employee: employeeId,
    status: 'approved',
    leaveType: { $ne: 'LOP' } as any,
    startDate: { $lte: periodTo },
    endDate: { $gte: periodFrom },
  }).toArray();

  let total = 0;
  for (const l of leaves) {
    const start = (l.startDate as Date) > periodFrom ? (l.startDate as Date) : periodFrom;
    const end = (l.endDate as Date) < periodTo ? (l.endDate as Date) : periodTo;
    if ((l as any).halfDay) {
      total += 0.5;
    } else {
      const cur = new Date(start);
      while (cur <= end) {
        if (cur.getDay() !== 0) total += 1;
        cur.setDate(cur.getDate() + 1);
      }
    }
  }
  return total;
}

export async function calcLateCount(employeeId: ObjectId, periodFrom: Date, periodTo: Date) {
  return collections.attendances().countDocuments({
    employee: employeeId,
    date: { $gte: periodFrom, $lte: periodTo },
    isLate: true,
  } as any);
}

export function calcLateLopDays(lateCount: number) {
  return Math.floor((lateCount || 0) / 3) * 0.5;
}

// FY 2026-27 New Tax Regime (Section 115BAC) — staircase calculation
export function calcAnnualTDS(annualCTC: number, annualEmployeeEPF: number) {
  const stdDeduction = 75000;
  const taxable = Math.max(0, annualCTC - stdDeduction - annualEmployeeEPF);
  if (taxable <= 1200000) return 0;

  let tax = 0;
  let remaining = taxable;
  if (remaining > 2400000) { tax += (remaining - 2400000) * 0.30; remaining = 2400000; }
  if (remaining > 2000000) { tax += (remaining - 2000000) * 0.25; remaining = 2000000; }
  if (remaining > 1600000) { tax += (remaining - 1600000) * 0.20; remaining = 1600000; }
  if (remaining > 1200000) { tax += (remaining - 1200000) * 0.15; remaining = 1200000; }
  if (remaining > 800000)  { tax += (remaining - 800000)  * 0.10; remaining = 800000; }
  if (remaining > 400000)  { tax += (remaining - 400000)  * 0.05; }
  const cess = tax * 0.04;
  return roundTwo(tax + cess);
}

export interface SalaryEmployee {
  annualCTC?: number;
  basicPercent?: number;
  daAmount?: number;
  enableEPF?: boolean;
}

export function calcSalaryComponents(
  employee: SalaryEmployee,
  workingDays: number,
  presentDays: number,
  leaveDays: number,
  overrideLopDays: number | undefined,
  lateLopDays: number,
  totalDaysInMonth: number,
) {
  const monthlyCTC = roundTwo((employee.annualCTC || 0) / 12);
  const basicPercent = (employee.basicPercent || 50) / 100;
  const basic = roundTwo(monthlyCTC * basicPercent);
  const hra = roundTwo(basic * 0.4);
  const da = roundTwo(employee.daAmount || 0);
  const epfEnabled = employee.enableEPF === true;
  const employerEPF = epfEnabled ? roundTwo(basic * 0.12) : 0;
  const employeeEPF = epfEnabled ? roundTwo(basic * 0.12) : 0;
  const grossEarnings = monthlyCTC;
  const specialAllowance = roundTwo(grossEarnings - basic - hra - da);

  let lopDays: number;
  if (overrideLopDays !== undefined && overrideLopDays !== null) {
    lopDays = Math.max(0, overrideLopDays);
  } else {
    lopDays = Math.max(0, workingDays - presentDays - leaveDays);
  }

  const perDaySalary = totalDaysInMonth > 0 ? monthlyCTC / totalDaysInMonth : 0;
  const lopDeduction = roundTwo(Math.max(0, lopDays) * perDaySalary);
  const lateLop = Math.max(0, lateLopDays || 0);
  const lateDeduction = roundTwo(lateLop * perDaySalary);
  const annualEmployeeEPF = employeeEPF * 12;
  const annualTDS = calcAnnualTDS(employee.annualCTC || 0, annualEmployeeEPF);
  const tds = roundTwo(annualTDS / 12);
  const professionalTax = 200;

  const totalDeductions = roundTwo(employerEPF + employeeEPF + lopDeduction + lateDeduction + tds + professionalTax);
  const netTakeHome = roundTwo(Math.max(0, grossEarnings - totalDeductions));
  const netPay = netTakeHome;

  return {
    monthlyCTC, basic, hra, da, specialAllowance,
    employerEPF, employeeEPF,
    lopDays, lopDeduction, lateLopDays: lateLop, lateDeduction,
    tds, professionalTax,
    grossEarnings, totalDeductions, netTakeHome, netPay,
  };
}

// ─── Populated slip helper ────────────────────────────────────────────────────

export async function populateSlip(id: ObjectId) {
  const rows = await collections.salarySlips().aggregate([
    { $match: { _id: id } },
    { $lookup: { from: 'employees', localField: 'employee', foreignField: '_id', as: '_employee' } },
  ]).toArray();
  if (rows.length === 0) return null;
  const slip: any = rows[0];
  const emp = slip._employee?.[0];
  if (emp) {
    let department: any = null;
    if (emp.department) {
      const dept = await collections.departments().findOne({ _id: emp.department });
      if (dept) department = { _id: dept._id, name: dept.name };
    }
    slip.employee = {
      _id: emp._id, name: emp.name, empId: emp.empId,
      designation: emp.designation, department,
    };
  }
  delete slip._employee;
  return slip;
}

export async function populateSlipsList(filter: any) {
  const rows = await collections.salarySlips().aggregate([
    { $match: filter },
    { $lookup: { from: 'employees', localField: 'employee', foreignField: '_id', as: '_employee' } },
    { $lookup: { from: 'departments', localField: '_employee.department', foreignField: '_id', as: '_department' } },
    { $sort: { createdAt: -1 } },
  ]).toArray();

  return rows.map(slip => {
    const emp = slip._employee?.[0];
    const dept = slip._department?.[0];
    if (emp) {
      slip.employee = {
        _id: emp._id, name: emp.name, empId: emp.empId,
        designation: emp.designation,
        department: dept ? { _id: dept._id, name: dept.name } : null,
      };
    }
    delete slip._employee; delete slip._department;
    return slip;
  });
}
