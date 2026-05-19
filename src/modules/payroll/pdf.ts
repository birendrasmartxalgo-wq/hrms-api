import PDFDocument from 'pdfkit';

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
const shortMonth = (d: Date) => d.toLocaleString('en-IN', { month: 'short' });
const shortYear = (d: Date) => `'${String(d.getFullYear()).slice(-2)}`;
const fmtPayDuration = (from: Date, to: Date) => {
  const f = new Date(from); const t = new Date(to);
  return `${ordinal(f.getDate())} ${shortMonth(f)}${shortYear(f)} to ${ordinal(t.getDate())} ${shortMonth(t)}${shortYear(t)}`;
};
function fmtShortDate(d?: Date | null) {
  if (!d) return '-';
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2, '0')}-${String(dt.getMonth() + 1).padStart(2, '0')}-${dt.getFullYear()}`;
}

export function numberToWords(num: number): string {
  num = Math.floor(Math.abs(Number(num) || 0));
  if (num === 0) return 'Zero';
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function below1000(n: number) {
    let str = '';
    if (n >= 100) { str += a[Math.floor(n / 100)] + ' Hundred '; n %= 100; }
    if (n >= 20) { str += b[Math.floor(n / 10)] + ' '; n %= 10; }
    if (n > 0) str += a[n] + ' ';
    return str.trim();
  }
  let result = '';
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  if (crore) result += below1000(crore) + ' Crore ';
  if (lakh) result += below1000(lakh) + ' Lakh ';
  if (thousand) result += below1000(thousand) + ' Thousand ';
  if (num) result += below1000(num);
  return result.trim();
}

export interface SlipForPdf {
  month: number;
  year: number;
  periodFrom: Date;
  periodTo: Date;
  paymentDate?: Date | null;
  workingDays?: number;
  leaveDays?: number;
  basic?: number;
  hra?: number;
  da?: number;
  specialAllowance?: number;
  employerEPF?: number;
  employeeEPF?: number;
  tds?: number;
  professionalTax?: number;
  lopDays?: number;
  lopDeduction?: number;
  lateLopDays?: number;
  lateDeduction?: number;
  lateCount?: number;
  bankAccountName?: string;
  bankAccountNo?: string;
  bankName?: string;
  bankAddress?: string;
  ifscCode?: string;
  epfNo?: string;
  esiNo?: string;
  employee: {
    name?: string;
    empId?: string;
    designation?: string;
    department?: { name?: string } | null;
  };
}

export function buildSalarySlipPdf(slip: SlipForPdf): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const monthName = new Date(slip.year, slip.month - 1, 1).toLocaleString('default', { month: 'long' });
      const doc = new PDFDocument({ margin: 30, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const GREEN = '#7CB342';
      const GREEN_BG = '#E8F5E9';
      const DARK = '#0f172a';
      const BORDER = '#9ca3af';
      const WHITE = '#ffffff';
      const MUTED = '#94a3b8';

      const pageWidth = doc.page.width - 60;
      const startX = 30;
      let y = 30;

      const fmt = (n: number | undefined) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      // Header row
      const hdrH = 70;
      const logoW = pageWidth * 0.27;
      const titleW = pageWidth * 0.36;
      const datesW = pageWidth - logoW - titleW;

      doc.rect(startX, y, logoW, hdrH).fill(GREEN).strokeColor(BORDER).lineWidth(0.8);
      doc.fillColor(WHITE).fontSize(20).font('Helvetica-Bold').text('Smartxalgo', startX + 12, y + 25, { width: logoW - 24 });
      doc.rect(startX, y, logoW, hdrH).strokeColor(BORDER).lineWidth(0.8).stroke();

      doc.rect(startX + logoW, y, titleW, hdrH).fill(WHITE).strokeColor(BORDER).lineWidth(0.8).stroke();
      doc.fillColor(DARK).fontSize(20).font('Helvetica-Bold').text('Salary Slip', startX + logoW, y + 14, { width: titleW, align: 'center' });
      doc.moveTo(startX + logoW, y + 44).lineTo(startX + logoW + titleW, y + 44).strokeColor(BORDER).lineWidth(0.8).stroke();
      doc.fillColor(DARK).fontSize(13).font('Helvetica').text(monthName, startX + logoW, y + 50, { width: titleW, align: 'center' });

      const dx = startX + logoW + titleW;
      doc.rect(dx, y, datesW, hdrH).fill(WHITE).strokeColor(BORDER).lineWidth(0.8).stroke();
      doc.fillColor(DARK).fontSize(9).font('Helvetica');
      doc.text(`Date : ${fmtShortDate(new Date())}`, dx + 8, y + 12, { width: datesW - 16 });
      doc.text(`Pay Date : ${fmtShortDate(slip.paymentDate)}`, dx + 8, y + 32, { width: datesW - 16 });
      doc.text(`Pay Duration : ${fmtPayDuration(slip.periodFrom, slip.periodTo)}`, dx + 8, y + 52, { width: datesW - 16 });
      y += hdrH;

      // Employee info grid
      const emp = slip.employee;
      const deptName = emp.department?.name || '-';
      const empCellH = 32;
      const halfW = pageWidth / 2;

      doc.rect(startX, y, halfW, empCellH).strokeColor(BORDER).lineWidth(0.8).stroke();
      doc.rect(startX + halfW, y, halfW, empCellH).strokeColor(BORDER).lineWidth(0.8).stroke();
      doc.fillColor(DARK).fontSize(10).font('Helvetica-Bold')
        .text('Name : ', startX + 8, y + 6, { continued: true }).font('Helvetica').text(emp.name || '-');
      doc.font('Helvetica-Bold').text('Employee ID : ', startX + 8, y + 19, { continued: true }).font('Helvetica').text(emp.empId || '-');
      doc.font('Helvetica-Bold').text('Title : ', startX + halfW + 8, y + 12, { continued: true }).font('Helvetica').text(emp.designation || '-');
      y += empCellH;

      doc.rect(startX, y, halfW, empCellH).strokeColor(BORDER).lineWidth(0.8).stroke();
      doc.rect(startX + halfW, y, halfW, empCellH).strokeColor(BORDER).lineWidth(0.8).stroke();
      doc.fillColor(DARK).fontSize(10).font('Helvetica-Bold')
        .text('No. of working days : ', startX + 8, y + 6, { continued: true }).font('Helvetica').text(String(slip.workingDays ?? 0));
      doc.font('Helvetica-Bold').text('No. of leaves : ', startX + 8, y + 19, { continued: true }).font('Helvetica').text(String(slip.leaveDays ?? 0));
      doc.font('Helvetica-Bold').text('Department : ', startX + halfW + 8, y + 12, { continued: true }).font('Helvetica').text(deptName);
      y += empCellH;

      // Salary table
      const col1W = pageWidth * 0.5;
      const col2W = pageWidth * 0.25;
      const col3W = pageWidth - col1W - col2W;
      const rowH = 20;

      doc.rect(startX, y, col1W, rowH).fill(GREEN_BG);
      doc.rect(startX + col1W, y, col2W, rowH).fill(GREEN_BG);
      doc.rect(startX + col1W + col2W, y, col3W, rowH).fill(GREEN_BG);
      doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold');
      doc.text('Description', startX, y + 5, { width: col1W, align: 'center' });
      doc.text('Earning', startX + col1W, y + 5, { width: col2W, align: 'center' });
      doc.text('Deduction', startX + col1W + col2W, y + 5, { width: col3W, align: 'center' });
      doc.rect(startX, y, col1W, rowH).strokeColor(BORDER).lineWidth(0.8).stroke();
      doc.rect(startX + col1W, y, col2W, rowH).strokeColor(BORDER).lineWidth(0.8).stroke();
      doc.rect(startX + col1W + col2W, y, col3W, rowH).strokeColor(BORDER).lineWidth(0.8).stroke();
      y += rowH;

      const tableRows: [string, number | null, number | null][] = [
        ['Basic Salary', slip.basic ?? 0, null],
        ['HRA (40% of Basic)', slip.hra ?? 0, null],
        ['DA', slip.da ?? 0, null],
        ['Special Allowance', slip.specialAllowance ?? 0, null],
        ['Employer EPF (12% of Basic)', null, slip.employerEPF ?? 0],
        ['Employee EPF (12% of Basic)', null, slip.employeeEPF ?? 0],
        ['TDS (Income Tax, New Regime)', null, slip.tds ?? 0],
        ['Professional Tax', null, slip.professionalTax ?? 0],
        [`LOP (${slip.lopDays || 0} day${(slip.lopDays || 0) === 1 ? '' : 's'})`, null, slip.lopDeduction || 0],
        [`Late Attendance LOP (${slip.lateLopDays || 0} day${(slip.lateLopDays || 0) === 1 ? '' : 's'}, ${slip.lateCount || 0} late)`, null, slip.lateDeduction || 0],
      ];
      const minRows = 8;
      while (tableRows.length < minRows) tableRows.push(['', null, null]);

      tableRows.forEach((row) => {
        doc.rect(startX, y, col1W, rowH).strokeColor(BORDER).lineWidth(0.5).stroke();
        doc.rect(startX + col1W, y, col2W, rowH).strokeColor(BORDER).lineWidth(0.5).stroke();
        doc.rect(startX + col1W + col2W, y, col3W, rowH).strokeColor(BORDER).lineWidth(0.5).stroke();
        doc.fontSize(10).font('Helvetica');
        if (row[0]) doc.fillColor(DARK).text(row[0], startX + 8, y + 5, { width: col1W - 16 });
        if (row[1] !== null) {
          const isZero = Number(row[1]) === 0;
          doc.fillColor(isZero ? MUTED : DARK).text(fmt(row[1]!), startX + col1W, y + 5, { width: col2W - 8, align: 'right' });
        }
        if (row[2] !== null) {
          const isZero = Number(row[2]) === 0;
          doc.fillColor(isZero ? MUTED : DARK).text(fmt(row[2]!), startX + col1W + col2W, y + 5, { width: col3W - 8, align: 'right' });
        }
        y += rowH;
      });

      const pdfTotalEarnings = Math.round(((slip.basic || 0) + (slip.hra || 0) + (slip.da || 0) + (slip.specialAllowance || 0)) * 100) / 100;
      const pdfTotalDeductions = Math.round(((slip.employerEPF || 0) + (slip.employeeEPF || 0) + (slip.tds || 0) + (slip.professionalTax || 0) + (slip.lopDeduction || 0) + (slip.lateDeduction || 0)) * 100) / 100;
      const pdfNetPay = Math.max(0, Math.round((pdfTotalEarnings - pdfTotalDeductions) * 100) / 100);

      // Total row
      doc.rect(startX, y, col1W, rowH).strokeColor(BORDER).lineWidth(0.8).stroke();
      doc.rect(startX + col1W, y, col2W, rowH).strokeColor(BORDER).lineWidth(0.8).stroke();
      doc.rect(startX + col1W + col2W, y, col3W, rowH).strokeColor(BORDER).lineWidth(0.8).stroke();
      doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold');
      doc.text('Total', startX, y + 5, { width: col1W, align: 'center' });
      doc.text(fmt(pdfTotalEarnings), startX + col1W, y + 5, { width: col2W - 8, align: 'right' });
      doc.text(fmt(pdfTotalDeductions), startX + col1W + col2W, y + 5, { width: col3W - 8, align: 'right' });
      y += rowH;

      // Footer: bank + net pay
      const leftW = pageWidth * 0.45;
      const rightW = pageWidth - leftW;
      const bankRows: [string, string][] = [
        ['Payment Date', fmtShortDate(slip.paymentDate)],
        ['Bank Name', slip.bankName || '-'],
        ['Bank Address', slip.bankAddress || '-'],
        ['Bank Account No.', slip.bankAccountNo || '-'],
        ['IFSC Code', slip.ifscCode || '-'],
        ['EPF', slip.epfNo || '-'],
        ['ESI', slip.esiNo || '-'],
      ];
      if (slip.bankAccountName) bankRows.unshift(['Account Name', slip.bankAccountName]);

      const bankStartY = y;
      bankRows.forEach((row) => {
        doc.rect(startX, y, leftW, rowH).strokeColor(BORDER).lineWidth(0.5).stroke();
        doc.fillColor(DARK).fontSize(10).font('Helvetica-Bold')
          .text(`${row[0]} : `, startX + 8, y + 5, { continued: true }).font('Helvetica').text(row[1]);
        y += rowH;
      });

      const rx = startX + leftW;
      let ry = bankStartY;
      doc.rect(rx, ry, rightW, rowH).fill(GREEN);
      doc.rect(rx, ry, rightW, rowH).strokeColor(BORDER).lineWidth(0.8).stroke();
      doc.fillColor(WHITE).fontSize(12).font('Helvetica-Bold').text('Net Pay', rx, ry + 5, { width: rightW, align: 'center' });
      ry += rowH;

      const inrH = rowH;
      doc.rect(rx, ry, rightW, inrH).fill(WHITE).strokeColor(BORDER).lineWidth(0.5).stroke();
      doc.fillColor(DARK).fontSize(12).font('Helvetica-Bold')
        .text('INR', rx + 10, ry + 5)
        .text(fmt(pdfNetPay), rx, ry + 5, { width: rightW - 10, align: 'right' });
      ry += inrH;

      const wordsH = (y - ry);
      doc.rect(rx, ry, rightW, wordsH).strokeColor(BORDER).lineWidth(0.5).stroke();
      const words = numberToWords(pdfNetPay);
      doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold')
        .text('Rupees in Words: ', rx + 8, ry + 6, { continued: true })
        .font('Helvetica-Oblique').text(words);

      y += 16;
      doc.fillColor('#b91c1c').fontSize(9).font('Helvetica')
        .text('Note: This is the computer generated slip. The signature not required.', startX, y, { width: pageWidth, align: 'center' });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
