import * as XLSX from 'xlsx';
import { roundTwo } from './service';

const MONTHS_LABEL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export interface ParsedImportRow {
  empId: string;
  presentDays: number;
  leaveDays?: number;
}

export function parseImportBuffer(buffer: Buffer): { rows: any[]; colMap: Record<string, string> } | { error: string } {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  if (!rows || rows.length === 0) return { error: 'Excel file is empty or has no data rows' };

  const headers = Object.keys(rows[0] as object);
  const hasEmpId = headers.some(h => h.toLowerCase().replace(/[\s_-]/g, '') === 'empid');
  const hasPresent = headers.some(h => h.toLowerCase().replace(/[\s_-]/g, '') === 'presentdays');
  if (!hasEmpId || !hasPresent) return { error: 'Excel must contain "empId" and "presentDays" columns' };

  const colMap: Record<string, string> = {};
  for (const h of headers) {
    const key = h.toLowerCase().replace(/[\s_-]/g, '');
    if (key === 'empid') colMap.empId = h;
    else if (key === 'presentdays') colMap.presentDays = h;
    else if (key === 'leavedays') colMap.leaveDays = h;
  }
  return { rows, colMap };
}

export function exportTemplate(employees: any[]): Buffer {
  const rows: any[][] = [['empId', 'Name', 'Department', 'Designation', 'presentDays', 'leaveDays']];
  for (const emp of employees) {
    rows.push([emp.empId, emp.name || '', emp.department?.name || '', emp.designation || '', '', '']);
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 10 }, { wch: 28 }, { wch: 18 }, { wch: 22 }, { wch: 14 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Employees');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function exportBankStatement(slips: any[]) {
  const rows: any[][] = [
    ['Sr. No.', 'Employee ID', 'Employee Name', 'Bank Account Name', 'Bank Account No.', 'Bank Name', 'IFSC Code', 'Net Pay (₹)', 'Payment Date'],
  ];
  let totalNetPay = 0;
  slips.forEach((slip, idx) => {
    const payDate = slip.paymentDate
      ? new Date(slip.paymentDate).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '';
    totalNetPay += slip.netPay || 0;
    rows.push([
      idx + 1,
      slip.employee?.empId || '',
      slip.employee?.name || '',
      slip.bankAccountName || '',
      slip.bankAccountNo || '',
      slip.bankName || '',
      slip.ifscCode || '',
      roundTwo(slip.netPay || 0),
      payDate,
    ]);
  });
  rows.push(['', '', '', '', '', '', 'TOTAL', roundTwo(totalNetPay), '']);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 8 }, { wch: 12 }, { wch: 28 }, { wch: 28 }, { wch: 20 }, { wch: 22 }, { wch: 14 }, { wch: 16 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Bank Statement');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function exportEPFOStatement(slips: any[]) {
  const rows: any[][] = [
    ['Sr. No.', 'Employee ID', 'Employee Name', 'UAN', 'Gross Wages (₹)', 'EPF Wages / Basic (₹)', 'EPF EE (12%)', 'EPF ER (12%)', 'EPS (8.33%, max ₹1250)', 'EDLI (0.5%, max ₹75)', 'EPF ER Diff (3.67%)', 'ESI No.', 'Net Pay (₹)'],
  ];
  const totals = { gross: 0, basic: 0, ee: 0, er: 0, eps: 0, edli: 0, erDiff: 0, net: 0 };
  slips.forEach((slip, idx) => {
    const basic = slip.basic || 0;
    const eeEPF = slip.employeeEPF || 0;
    const erEPF = slip.employerEPF || 0;
    const eps = roundTwo(Math.min(basic * 0.0833, 1250));
    const edli = roundTwo(Math.min(basic * 0.005, 75));
    const erDiff = roundTwo(erEPF - eps);

    totals.gross += slip.grossEarnings || 0;
    totals.basic += basic;
    totals.ee += eeEPF;
    totals.er += erEPF;
    totals.eps += eps;
    totals.edli += edli;
    totals.erDiff += erDiff;
    totals.net += slip.netPay || 0;

    rows.push([
      idx + 1, slip.employee?.empId || '', slip.employee?.name || '', slip.epfNo || '',
      roundTwo(slip.grossEarnings || 0), roundTwo(basic), roundTwo(eeEPF), roundTwo(erEPF),
      eps, edli, erDiff, slip.esiNo || '', roundTwo(slip.netPay || 0),
    ]);
  });
  rows.push([
    '', '', '', 'TOTAL', roundTwo(totals.gross), roundTwo(totals.basic),
    roundTwo(totals.ee), roundTwo(totals.er), roundTwo(totals.eps), roundTwo(totals.edli),
    roundTwo(totals.erDiff), '', roundTwo(totals.net),
  ]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 8 }, { wch: 12 }, { wch: 28 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, 'EPFO Statement');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function exportWorkingDays(slips: any[]) {
  const rows: any[][] = [
    ['Sr. No.', 'Employee ID', 'Employee Name', 'Department', 'Designation', 'Working Days', 'Present Days', 'Leave Days', 'LOP Days', 'Late Count', 'Late LOP Days', 'Status'],
  ];
  slips.forEach((slip, idx) => {
    rows.push([
      idx + 1, slip.employee?.empId || '', slip.employee?.name || '',
      slip.employee?.department?.name || '', slip.employee?.designation || '',
      slip.workingDays || 0, slip.presentDays || 0, slip.leaveDays || 0, slip.lopDays || 0,
      slip.lateCount || 0, slip.lateLopDays || 0,
      slip.status === 'finalized' ? 'Finalized' : 'Draft',
    ]);
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 8 }, { wch: 12 }, { wch: 28 }, { wch: 18 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Working Days');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function fileNameForMonth(prefix: string, month: number, year: number, ext = 'xlsx') {
  return `${prefix}-${MONTHS_LABEL[month - 1]}-${year}.${ext}`;
}
