import { Elysia } from 'elysia';
import { ObjectId } from 'mongodb';
import { authPlugin } from '../../plugins/auth';
import { collections } from '../../db/collections';
import { putObject, buildUploadKey } from '../../services/s3';
import { notifyEmployee } from '../../services/notify';
import { PayrollSchemas } from './schema';
import {
  IFSC_RE, validateConfig,
  getSalaryPeriod, daysInMonthOf, getWorkingDaysList, calcWorkingDays,
  calcPresentDays, calcApprovedLeaveDays, calcLateCount, calcLateLopDays,
  calcSalaryComponents, roundTwo,
  populateSlip, populateSlipsList,
} from './service';
import { buildSalarySlipPdf } from './pdf';
import { parseImportBuffer, exportTemplate, exportBankStatement, exportEPFOStatement, exportWorkingDays, fileNameForMonth } from './excel';

function oid(v: any) {
  if (v instanceof ObjectId) return v;
  if (typeof v === 'string' && ObjectId.isValid(v)) return new ObjectId(v);
  return null;
}

async function getPayrollPeriodConfig() {
  const setting = await collections.settings().findOne({ key: 'payroll_period' });
  return (setting?.value as { startDay?: number; endDay?: number } | undefined) || null;
}

async function notifySlipFinalized(slip: any, monthName: string, year: number) {
  if (!slip.employee) return;
  const empId = slip.employee._id || slip.employee;
  await notifyEmployee(empId, {
    title: 'Salary Slip Ready',
    body: `Your salary slip for ${monthName} ${year} has been finalized. Net Pay: ₹${(slip.netPay || 0).toLocaleString('en-IN')}`,
    type: 'info',
    link: '/payroll',
  }).catch(e => console.warn('Salary slip notify failed:', (e as Error).message));
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const payrollController = new Elysia({ prefix: '/payroll' })
  .use(authPlugin)
  .guard({ authorize: true as const }, app => app

  // ─── EMPLOYEE: my slips ───────────────────────────────────────────────────
  .get('/my', async ({ user, set }) => {
    if (!user?.employeeId) { set.status = 400; return { message: 'Employee not found' }; }
    const empId = oid(user.employeeId)!;
    const slips = await collections.salarySlips().find(
      { employee: empId, status: 'finalized' },
      { sort: { year: -1, month: -1 } } as any,
    ).toArray();
    return slips;
  })

  // ─── IFSC lookup (admin/hr) ───────────────────────────────────────────────
  .get('/ifsc/:code', async ({ user, params, set }) => {
    if (user?.role !== 'admin' && user?.role !== 'hr') { set.status = 403; return { message: 'Forbidden' }; }
    const code = String(params.code || '').trim().toUpperCase();
    if (!IFSC_RE.test(code)) { set.status = 400; return { message: 'Invalid IFSC format' }; }
    try {
      const resp = await fetch(`https://ifsc.razorpay.com/${code}`);
      if (resp.status === 404) { set.status = 404; return { message: 'IFSC not found' }; }
      if (!resp.ok) { set.status = 500; return { message: 'IFSC lookup failed' }; }
      const d: any = await resp.json();
      return {
        ifsc: code,
        bank: d.BANK || d.bank || '',
        branch: d.BRANCH || d.branch || '',
        address: d.ADDRESS || d.address || '',
        city: d.CITY || d.city || '',
        state: d.STATE || d.state || '',
      };
    } catch (e) {
      set.status = 500;
      return { message: (e as Error).message || 'IFSC lookup failed' };
    }
  })

  // ─── Export template (admin) ──────────────────────────────────────────────
  .get('/export-template', async ({ user, set }) => {
    if (user?.role !== 'admin') { set.status = 403; return { message: 'Forbidden' }; }
    const employees = await collections.employees().aggregate([
      { $match: { isActive: { $ne: false } } },
      { $lookup: { from: 'departments', localField: 'department', foreignField: '_id', as: '_department' } },
      { $project: { empId: 1, name: 1, designation: 1, department: { $arrayElemAt: ['$_department', 0] } } },
    ]).toArray();
    const buf = exportTemplate(employees);
    set.headers['Content-Type'] = XLSX_MIME;
    set.headers['Content-Disposition'] = 'attachment; filename="payroll-import-template.xlsx"';
    return buf;
  })

  // ─── Export bank statement (admin) ────────────────────────────────────────
  .get('/export-bank-statement', async ({ user, query, set }) => {
    if (user?.role !== 'admin') { set.status = 403; return { message: 'Forbidden' }; }
    const month = parseInt(query.month);
    const year = parseInt(query.year);
    if (!month || !year) { set.status = 400; return { message: 'month and year required' }; }
    const slips = await populateSlipsList({ month, year, status: 'finalized' });
    if (slips.length === 0) { set.status = 404; return { message: 'No finalized slips found for this month' }; }
    slips.sort((a: any, b: any) => (a.employee?.empId || '').localeCompare(b.employee?.empId || ''));
    const buf = exportBankStatement(slips);
    set.headers['Content-Type'] = XLSX_MIME;
    set.headers['Content-Disposition'] = `attachment; filename="${fileNameForMonth('bank-statement', month, year)}"`;
    return buf;
  }, PayrollSchemas.MonthYearQuery)

  // ─── Export EPFO (admin) ──────────────────────────────────────────────────
  .get('/export-epfo', async ({ user, query, set }) => {
    if (user?.role !== 'admin') { set.status = 403; return { message: 'Forbidden' }; }
    const month = parseInt(query.month);
    const year = parseInt(query.year);
    if (!month || !year) { set.status = 400; return { message: 'month and year required' }; }
    const slips = await populateSlipsList({ month, year, status: 'finalized', enableEPF: true });
    if (slips.length === 0) { set.status = 404; return { message: 'No finalized EPF-enabled slips found for this month' }; }
    slips.sort((a: any, b: any) => (a.employee?.empId || '').localeCompare(b.employee?.empId || ''));
    const buf = exportEPFOStatement(slips);
    set.headers['Content-Type'] = XLSX_MIME;
    set.headers['Content-Disposition'] = `attachment; filename="${fileNameForMonth('epfo-statement', month, year)}"`;
    return buf;
  }, PayrollSchemas.MonthYearQuery)

  // ─── Export Working Days (admin) ──────────────────────────────────────────
  .get('/export-working-days', async ({ user, query, set }) => {
    if (user?.role !== 'admin') { set.status = 403; return { message: 'Forbidden' }; }
    const month = parseInt(query.month);
    const year = parseInt(query.year);
    if (!month || !year) { set.status = 400; return { message: 'month and year required' }; }
    const slips = await populateSlipsList({ month, year });
    if (slips.length === 0) { set.status = 404; return { message: 'No salary slips found for this month' }; }
    slips.sort((a: any, b: any) => (a.employee?.empId || '').localeCompare(b.employee?.empId || ''));
    const buf = exportWorkingDays(slips);
    set.headers['Content-Type'] = XLSX_MIME;
    set.headers['Content-Disposition'] = `attachment; filename="${fileNameForMonth('working-days', month, year)}"`;
    return buf;
  }, PayrollSchemas.MonthYearQuery)

  // ─── Get config by empId (admin/hr) ───────────────────────────────────────
  .get('/employee/:empId/config', async ({ user, params, set }) => {
    if (user?.role !== 'admin' && user?.role !== 'hr') { set.status = 403; return { message: 'Forbidden' }; }
    const emp = await collections.employees().findOne({ empId: params.empId });
    if (!emp) { set.status = 404; return { message: 'Employee not found' }; }
    let department: any = null;
    if (emp.department) {
      const dept = await collections.departments().findOne({ _id: emp.department as any });
      if (dept) department = { _id: dept._id, name: dept.name };
    }
    const revisionCount = await collections.salaryRevisions().countDocuments({ employee: emp._id });
    const lastRev = await collections.salaryRevisions().findOne({ employee: emp._id }, { sort: { version: -1 } } as any);
    return {
      _id: emp._id, name: emp.name, empId: emp.empId,
      annualCTC: emp.annualCTC, basicPercent: emp.basicPercent, daAmount: emp.daAmount,
      enableEPF: emp.enableEPF, enableESI: emp.enableESI,
      bankAccountName: emp.bankAccountName, bankAccountNo: emp.bankAccountNo,
      bankName: emp.bankName, bankAddress: emp.bankAddress, ifscCode: emp.ifscCode,
      epfNo: emp.epfNo, esiNo: emp.esiNo,
      department, designation: emp.designation,
      revisionCount, latestVersion: lastRev?.version || 0,
    };
  })

  // ─── Get revisions (admin/hr) ─────────────────────────────────────────────
  .get('/employee/:empId/revisions', async ({ user, params, set }) => {
    if (user?.role !== 'admin' && user?.role !== 'hr') { set.status = 403; return { message: 'Forbidden' }; }
    const emp = await collections.employees().findOne({ empId: params.empId }, { projection: { _id: 1 } });
    if (!emp) { set.status = 404; return { message: 'Employee not found' }; }
    const revisions = await collections.salaryRevisions().aggregate([
      { $match: { employee: emp._id } },
      { $lookup: { from: 'users', localField: 'createdBy', foreignField: '_id', as: '_createdBy' } },
      { $sort: { version: -1 } },
    ]).toArray();
    return revisions.map(r => {
      const cb = r._createdBy?.[0];
      r.createdBy = cb ? { _id: cb._id, name: cb.name } : null;
      delete r._createdBy;
      return r;
    });
  })

  // ─── Update config (admin/hr) ─────────────────────────────────────────────
  .patch('/employee/:empId/config', async ({ user, params, body, set }) => {
    if (user?.role !== 'admin' && user?.role !== 'hr') { set.status = 403; return { message: 'Forbidden' }; }
    const emp = await collections.employees().findOne({ empId: params.empId });
    if (!emp) { set.status = 404; return { message: 'Employee not found' }; }

    const { errors, clean } = validateConfig(body || {});
    if (Object.keys(errors).length > 0) { set.status = 400; return { message: 'Validation failed', errors }; }

    await collections.employees().updateOne({ _id: emp._id }, { $set: { ...clean, updatedAt: new Date() } });

    if ((body as any).effectiveFromMonth && (body as any).effectiveFromYear) {
      const effectiveFrom = new Date(Number((body as any).effectiveFromYear), Number((body as any).effectiveFromMonth) - 1, 1);
      const lastRev = await collections.salaryRevisions().findOne({ employee: emp._id }, { sort: { version: -1 }, projection: { version: 1 } } as any);
      const version = (lastRev?.version || 0) + 1;
      const updated = await collections.employees().findOne({ _id: emp._id });
      await collections.salaryRevisions().insertOne({
        _id: new ObjectId(),
        employee: emp._id,
        version,
        annualCTC: updated?.annualCTC || 0,
        basicPercent: updated?.basicPercent,
        daAmount: updated?.daAmount,
        enableEPF: updated?.enableEPF,
        enableESI: updated?.enableESI,
        effectiveFrom,
        createdBy: user?.userId ? oid(user.userId) || undefined : undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const updated = await collections.employees().findOne({ _id: emp._id });
    return { message: 'Config updated', employee: updated };
  }, PayrollSchemas.Config)

  // ─── Generate payroll (admin) ─────────────────────────────────────────────
  .post('/generate', async ({ user, body, set }) => {
    if (user?.role !== 'admin') { set.status = 403; return { message: 'Forbidden' }; }
    const month = Number(body.month);
    const year = Number(body.year);
    const periodConfig = await getPayrollPeriodConfig();
    const { periodFrom, periodTo } = getSalaryPeriod(month, year, periodConfig);
    const parsedPaymentDate = body.paymentDate ? new Date(body.paymentDate) : null;
    const totalDaysInMonth = daysInMonthOf(periodTo);
    const workingDaysList = await getWorkingDaysList(periodFrom, periodTo);
    const workingDays = workingDaysList.length;
    const fillAbsent = Boolean(body.preFillPresent);

    const adminUsers = await collections.users().find({ role: 'admin' }, { projection: { _id: 1 } }).toArray();
    const adminUserIds = adminUsers.map(u => u._id);

    const query: any = { isActive: { $ne: false }, user: { $nin: adminUserIds } };
    if (body.employeeIds && body.employeeIds.length > 0) {
      query._id = { $in: body.employeeIds.map(oid).filter(Boolean) };
    }
    const employees = await collections.employees().find(query).toArray();

    const results: any[] = [];
    for (const emp of employees) {
      const rev = await collections.salaryRevisions().findOne(
        { employee: emp._id, effectiveFrom: { $lte: periodTo } } as any,
        { sort: { effectiveFrom: -1 } } as any,
      );
      const salData: any = { ...emp };
      if (rev) {
        Object.assign(salData, {
          annualCTC: rev.annualCTC,
          basicPercent: rev.basicPercent,
          daAmount: rev.daAmount,
          enableEPF: rev.enableEPF,
          enableESI: rev.enableESI,
        });
      }
      if (!salData.annualCTC || salData.annualCTC <= 0) {
        results.push({ empId: emp.empId, name: emp.name, skipped: true, reason: 'CTC not configured' });
        continue;
      }

      const existing = await collections.salarySlips().findOne({ employee: emp._id, month, year });
      if (existing) {
        if (existing.status === 'draft' && parsedPaymentDate) {
          await collections.salarySlips().updateOne({ _id: existing._id }, { $set: { paymentDate: parsedPaymentDate, updatedAt: new Date() } });
          results.push({ empId: emp.empId, name: emp.name, skipped: true, reason: 'Draft exists — disbursement date updated' });
        } else {
          const reason = existing.status === 'finalized' ? 'Already finalized' : 'Draft exists (edit or delete to regenerate)';
          results.push({ empId: emp.empId, name: emp.name, skipped: true, reason });
        }
        continue;
      }

      const presentDays = await calcPresentDays(emp._id, periodFrom, periodTo, fillAbsent, workingDaysList);
      const leaveDays = await calcApprovedLeaveDays(emp._id, periodFrom, periodTo);
      const lateCount = await calcLateCount(emp._id, periodFrom, periodTo);
      const lateLopDays = calcLateLopDays(lateCount);
      const comps = calcSalaryComponents(salData, workingDays, presentDays, leaveDays, undefined, lateLopDays, totalDaysInMonth);

      await collections.salarySlips().insertOne({
        _id: new ObjectId(),
        employee: emp._id,
        month, year,
        periodFrom, periodTo,
        workingDays, presentDays, leaveDays,
        lopDays: comps.lopDays,
        lateCount,
        monthlyCTC: comps.monthlyCTC, basic: comps.basic, hra: comps.hra, da: comps.da,
        specialAllowance: comps.specialAllowance,
        employerEPF: comps.employerEPF, employeeEPF: comps.employeeEPF,
        lopDeduction: comps.lopDeduction, lateLopDays: comps.lateLopDays, lateDeduction: comps.lateDeduction,
        tds: comps.tds, professionalTax: comps.professionalTax,
        grossEarnings: comps.grossEarnings, totalDeductions: comps.totalDeductions,
        netTakeHome: comps.netTakeHome, netPay: comps.netPay,
        paymentDate: parsedPaymentDate || undefined,
        bankAccountName: emp.bankAccountName || '',
        bankAccountNo: emp.bankAccountNo || '',
        bankName: emp.bankName || '',
        bankAddress: emp.bankAddress || '',
        ifscCode: emp.ifscCode || '',
        epfNo: emp.epfNo || '',
        esiNo: emp.esiNo || '',
        enableEPF: salData.enableEPF || false,
        enableESI: salData.enableESI || false,
        status: 'draft',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      results.push({ empId: emp.empId, name: emp.name, skipped: false, netPay: comps.netPay });
    }

    let finalizedCount = 0;
    if (body.finalizeAfter) {
      const adminEmpOid = user?.employeeId ? oid(user.employeeId) : null;
      const drafts = await collections.salarySlips().find({ month, year, status: 'draft' }).toArray();
      const monthName = new Date(year, month - 1, 1).toLocaleString('default', { month: 'long' });
      for (const slip of drafts) {
        await collections.salarySlips().updateOne({ _id: slip._id }, {
          $set: { status: 'finalized', finalizedBy: adminEmpOid || undefined, finalizedAt: new Date(), updatedAt: new Date() },
        });
        await notifySlipFinalized({ employee: slip.employee, netPay: slip.netPay }, monthName, year);
        finalizedCount++;
      }
    }

    return {
      message: body.finalizeAfter ? 'Payroll generated and finalized' : 'Payroll generated',
      count: results.filter(r => !r.skipped).length,
      finalizedCount,
      results,
    };
  }, PayrollSchemas.Generate)

  // ─── Import Excel (admin) ─────────────────────────────────────────────────
  .post('/import-excel', async ({ user, body, set }) => {
    if (user?.role !== 'admin') { set.status = 403; return { message: 'Forbidden' }; }
    const month = Number(body.month);
    const year = Number(body.year);
    if (!month || !year) { set.status = 400; return { message: 'month and year required' }; }
    const file = body.file;
    if (!file) { set.status = 400; return { message: 'Excel file is required' }; }
    const ok = file.name.toLowerCase().endsWith('.xlsx') || file.type === XLSX_MIME || file.type === 'application/octet-stream';
    if (!ok) { set.status = 400; return { message: 'Only .xlsx files are accepted' }; }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Archive the upload to S3 (best-effort)
    try {
      const key = buildUploadKey({
        purpose: 'payroll-import',
        contentType: XLSX_MIME,
        payrollMonth: `${year}-${String(month).padStart(2, '0')}`,
      });
      await putObject(key, buffer, XLSX_MIME);
    } catch (e) {
      console.warn('[payroll] archive of import failed:', (e as Error).message);
    }

    const parsed = parseImportBuffer(buffer);
    if ('error' in parsed) { set.status = 400; return { message: parsed.error }; }
    const { rows, colMap } = parsed;

    const periodConfig = await getPayrollPeriodConfig();
    const { periodFrom, periodTo } = getSalaryPeriod(month, year, periodConfig);
    const workingDays = await calcWorkingDays(periodFrom, periodTo);
    const totalDaysInMonth = daysInMonthOf(periodTo);

    const results: any = { updated: [], errors: [], skipped: [] };

    for (const row of rows as any[]) {
      const empIdStr = String(row[colMap.empId]).trim();
      const presentDays = Number(row[colMap.presentDays]);
      const leaveDays = colMap.leaveDays && row[colMap.leaveDays] !== undefined ? Number(row[colMap.leaveDays]) : 0;

      if (!empIdStr || isNaN(presentDays) || presentDays < 0) {
        results.errors.push({ empId: empIdStr || '(empty)', reason: 'Invalid empId or presentDays' });
        continue;
      }

      const emp = await collections.employees().findOne({ empId: empIdStr });
      if (!emp) { results.errors.push({ empId: empIdStr, reason: 'Employee not found' }); continue; }
      if (!emp.annualCTC || emp.annualCTC <= 0) {
        results.skipped.push({ empId: empIdStr, name: emp.name, reason: 'CTC not configured' });
        continue;
      }

      const lateCount = await calcLateCount(emp._id, periodFrom, periodTo);
      const lateLopDays = calcLateLopDays(lateCount);

      const existing = await collections.salarySlips().findOne({ employee: emp._id, month, year });
      let slip: any;
      if (!existing) {
        const comps = calcSalaryComponents(emp as any, workingDays, presentDays, leaveDays, undefined, lateLopDays, totalDaysInMonth);
        slip = {
          _id: new ObjectId(),
          employee: emp._id,
          month, year, periodFrom, periodTo,
          workingDays,
          presentDays: Math.max(0, presentDays),
          leaveDays: Math.max(0, leaveDays),
          lopDays: comps.lopDays,
          lateCount,
          monthlyCTC: comps.monthlyCTC, basic: comps.basic, hra: comps.hra, da: comps.da,
          specialAllowance: comps.specialAllowance,
          employerEPF: comps.employerEPF, employeeEPF: comps.employeeEPF,
          lopDeduction: comps.lopDeduction, lateLopDays: comps.lateLopDays, lateDeduction: comps.lateDeduction,
          tds: comps.tds, professionalTax: comps.professionalTax,
          grossEarnings: comps.grossEarnings, totalDeductions: comps.totalDeductions,
          netTakeHome: comps.netTakeHome, netPay: comps.netPay,
          paymentDate: undefined,
          bankAccountName: emp.bankAccountName || '',
          bankAccountNo: emp.bankAccountNo || '',
          bankName: emp.bankName || '',
          bankAddress: emp.bankAddress || '',
          ifscCode: emp.ifscCode || '',
          epfNo: emp.epfNo || '',
          esiNo: emp.esiNo || '',
          enableEPF: emp.enableEPF || false,
          enableESI: emp.enableESI || false,
          status: 'draft',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await collections.salarySlips().insertOne(slip);
      } else {
        if (existing.status === 'finalized') {
          results.errors.push({ empId: empIdStr, name: emp.name, reason: 'Slip already finalized, cannot modify' });
          continue;
        }
        slip = existing;
        slip.presentDays = Math.max(0, presentDays);
        slip.leaveDays = Math.max(0, leaveDays);
        slip.lopDays = Math.max(0, workingDays - slip.presentDays - slip.leaveDays);
        slip.workingDays = workingDays;
        slip.lateCount = lateCount;
        slip.lateLopDays = lateLopDays;
        if (slip.enableEPF) {
          slip.employerEPF = roundTwo((slip.basic || 0) * 0.12);
          slip.employeeEPF = roundTwo((slip.basic || 0) * 0.12);
        }
        const perDaySalary = totalDaysInMonth > 0 ? (slip.monthlyCTC || slip.grossEarnings || 0) / totalDaysInMonth : 0;
        slip.lopDeduction = roundTwo(Math.max(0, slip.lopDays || 0) * perDaySalary);
        slip.lateDeduction = roundTwo(lateLopDays * perDaySalary);
        const tds = slip.tds || 0;
        const pt = slip.professionalTax || 0;
        slip.totalDeductions = roundTwo((slip.employerEPF || 0) + (slip.employeeEPF || 0) + slip.lopDeduction + slip.lateDeduction + tds + pt);
        slip.netTakeHome = roundTwo(Math.max(0, (slip.grossEarnings || 0) - slip.totalDeductions));
        slip.netPay = slip.netTakeHome;
        slip.updatedAt = new Date();
        await collections.salarySlips().updateOne({ _id: slip._id }, { $set: slip });
      }

      results.updated.push({
        empId: empIdStr, name: emp.name,
        presentDays: slip.presentDays, leaveDays: slip.leaveDays,
        lopDays: slip.lopDays, netPay: slip.netPay,
      });
    }

    return {
      message: `Import complete: ${results.updated.length} updated, ${results.skipped.length} skipped, ${results.errors.length} errors`,
      results,
    };
  }, PayrollSchemas.ImportExcel)

  // ─── Finalize all (admin) ─────────────────────────────────────────────────
  .post('/finalize-all', async ({ user, body, set }) => {
    if (user?.role !== 'admin') { set.status = 403; return { message: 'Forbidden' }; }
    const month = Number(body.month);
    const year = Number(body.year);
    const adminEmpOid = user?.employeeId ? oid(user.employeeId) : null;
    const drafts = await collections.salarySlips().find({ month, year, status: 'draft' }).toArray();
    const monthName = new Date(year, month - 1, 1).toLocaleString('default', { month: 'long' });

    let count = 0;
    for (const slip of drafts) {
      await collections.salarySlips().updateOne({ _id: slip._id }, {
        $set: { status: 'finalized', finalizedBy: adminEmpOid || undefined, finalizedAt: new Date(), updatedAt: new Date() },
      });
      await notifySlipFinalized({ employee: slip.employee, netPay: slip.netPay }, monthName, year);
      count++;
    }
    return { message: `Finalized ${count} salary slips` };
  }, PayrollSchemas.FinalizeAll)

  // ─── Bulk finalize by ids (admin) ─────────────────────────────────────────
  .post('/bulk-finalize', async ({ user, body, set }) => {
    if (user?.role !== 'admin') { set.status = 403; return { message: 'Forbidden' }; }
    const ids = body.ids.map(oid).filter((x): x is ObjectId => !!x);
    const adminEmpOid = user?.employeeId ? oid(user.employeeId) : null;
    const drafts = await collections.salarySlips().find({ _id: { $in: ids }, status: 'draft' }).toArray();

    let count = 0;
    for (const slip of drafts) {
      await collections.salarySlips().updateOne({ _id: slip._id }, {
        $set: { status: 'finalized', finalizedBy: adminEmpOid || undefined, finalizedAt: new Date(), updatedAt: new Date() },
      });
      const monthName = new Date(slip.year!, (slip.month || 1) - 1, 1).toLocaleString('default', { month: 'long' });
      await notifySlipFinalized({ employee: slip.employee, netPay: slip.netPay }, monthName, slip.year!);
      count++;
    }
    const skipped = body.ids.length - count;
    return {
      message: `Finalized ${count} salary slip${count !== 1 ? 's' : ''}${skipped > 0 ? ` (${skipped} skipped — not draft or not found)` : ''}`,
      finalizedCount: count,
      skipped,
    };
  }, PayrollSchemas.BulkFinalize)

  // ─── Bulk payment date (admin) ────────────────────────────────────────────
  .post('/bulk-payment-date', async ({ user, body, set }) => {
    if (user?.role !== 'admin') { set.status = 403; return { message: 'Forbidden' }; }
    const filter: any = { month: Number(body.month), year: Number(body.year) };
    if (body.ids && body.ids.length > 0) {
      filter._id = { $in: body.ids.map(oid).filter(Boolean) };
    }
    const result = await collections.salarySlips().updateMany(filter, { $set: { paymentDate: new Date(body.paymentDate), updatedAt: new Date() } });
    return { message: `Payment date updated for ${result.modifiedCount} slips` };
  }, PayrollSchemas.BulkPaymentDate)

  // ─── Bulk delete drafts (admin) ───────────────────────────────────────────
  .delete('/bulk-delete', async ({ user, body, set }) => {
    if (user?.role !== 'admin') { set.status = 403; return { message: 'Forbidden' }; }
    const filter: any = { status: 'draft' };
    if (Array.isArray(body.ids) && body.ids.length > 0) {
      filter._id = { $in: body.ids.map(oid).filter(Boolean) };
    } else if (body.month && body.year) {
      filter.month = Number(body.month);
      filter.year = Number(body.year);
    } else {
      set.status = 400; return { message: 'Provide either { month, year } or { ids: [...] }' };
    }
    const result = await collections.salarySlips().deleteMany(filter);
    return {
      message: `Deleted ${result.deletedCount} draft slip${result.deletedCount !== 1 ? 's' : ''}`,
      deletedCount: result.deletedCount,
    };
  }, PayrollSchemas.BulkDelete)

  // ─── List slips (admin/hr) ────────────────────────────────────────────────
  .get('/', async ({ user, query, set }) => {
    if (user?.role !== 'admin' && user?.role !== 'hr') { set.status = 403; return { message: 'Forbidden' }; }
    const filter: any = {};
    if (query.month) filter.month = Number(query.month);
    if (query.year) filter.year = Number(query.year);
    if (query.status) filter.status = query.status;
    return await populateSlipsList(filter);
  }, PayrollSchemas.List)

  // ─── PDF (auth — access check for employees) ──────────────────────────────
  .get('/:id/pdf', async ({ user, params, set }) => {
    const slipId = oid(params.id);
    if (!slipId) { set.status = 400; return { message: 'Invalid slip id' }; }
    const slip = await populateSlip(slipId);
    if (!slip) { set.status = 404; return { message: 'Salary slip not found' }; }

    if (user?.role === 'employee') {
      const empOid = user?.employeeId ? oid(user.employeeId) : null;
      if (!empOid || !slip.employee._id.equals(empOid)) { set.status = 403; return { message: 'Access denied' }; }
    }

    const monthName = new Date(slip.year, slip.month - 1, 1).toLocaleString('default', { month: 'long' });
    const fileName = `salary-slip-${slip.employee.empId}-${monthName}-${slip.year}.pdf`;

    // If finalized, optionally cache PDF in S3 — for now, generate on the fly each time.
    const buf = await buildSalarySlipPdf(slip);
    set.headers['Content-Type'] = 'application/pdf';
    set.headers['Content-Disposition'] = `attachment; filename="${fileName}"`;
    return buf;
  })

  // ─── Late details (auth — access check for employees) ─────────────────────
  .get('/:id/late-details', async ({ user, params, set }) => {
    const slipId = oid(params.id);
    if (!slipId) { set.status = 400; return { message: 'Invalid slip id' }; }
    const slip = await collections.salarySlips().findOne({ _id: slipId });
    if (!slip) { set.status = 404; return { message: 'Salary slip not found' }; }

    if (user?.role === 'employee') {
      const empOid = user?.employeeId ? oid(user.employeeId) : null;
      if (!empOid || !slip.employee.equals(empOid)) { set.status = 403; return { message: 'Access denied' }; }
    }

    const records = await collections.attendances().find({
      employee: slip.employee,
      date: { $gte: slip.periodFrom, $lte: slip.periodTo },
      isLate: true,
    } as any, { sort: { date: 1 } } as any).toArray();

    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const formatted = records.map(r => {
      const d = new Date(r.date);
      return {
        date: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
        dayOfWeek: DAYS[d.getDay()],
        checkIn: r.punchIn?.time ? new Date(r.punchIn.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : null,
        checkOut: r.punchOut?.time ? new Date(r.punchOut.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : null,
        status: r.status,
      };
    });
    const lateCount = records.length;
    const lateLopDays = Math.floor(lateCount / 3) * 0.5;
    return { lateCount, lateLopDays, records: formatted };
  })

  // ─── Get one slip (auth — access check for employees) ─────────────────────
  .get('/:id', async ({ user, params, set }) => {
    const slipId = oid(params.id);
    if (!slipId) { set.status = 400; return { message: 'Invalid slip id' }; }
    const slip = await populateSlip(slipId);
    if (!slip) { set.status = 404; return { message: 'Salary slip not found' }; }
    if (user?.role === 'employee') {
      const empOid = user?.employeeId ? oid(user.employeeId) : null;
      if (!empOid || !slip.employee._id.equals(empOid)) { set.status = 403; return { message: 'Access denied' }; }
    }
    return slip;
  })

  // ─── Update slip (admin) ──────────────────────────────────────────────────
  .patch('/:id', async ({ user, params, body, set }) => {
    if (user?.role !== 'admin') { set.status = 403; return { message: 'Forbidden' }; }
    const slipId = oid(params.id);
    if (!slipId) { set.status = 400; return { message: 'Invalid slip id' }; }
    const slip = await collections.salarySlips().findOne({ _id: slipId });
    if (!slip) { set.status = 404; return { message: 'Salary slip not found' }; }

    const errors: Record<string, string> = {};
    const { presentDays, leaveDays, lopDays, lateLopDays, paymentDate, remarks } = body as any;

    if (lopDays !== undefined) {
      const n = Number(lopDays);
      if (!Number.isFinite(n) || n < 0) errors.lopDays = 'LOP days must be ≥ 0';
      else if (n > (slip.workingDays || 31)) errors.lopDays = `LOP days cannot exceed working days (${slip.workingDays})`;
    }
    if (lateLopDays !== undefined) {
      const n = Number(lateLopDays);
      if (!Number.isFinite(n) || n < 0) errors.lateLopDays = 'Late LOP days must be ≥ 0';
      else if (n > 31) errors.lateLopDays = 'Late LOP days cannot exceed 31';
    }
    if (remarks !== undefined && String(remarks).length > 500) errors.remarks = 'Remarks max 500 characters';
    if (Object.keys(errors).length > 0) { set.status = 400; return { message: 'Validation failed', errors }; }

    const upd: any = { ...slip };
    if (lopDays !== undefined) upd.lopDays = Math.max(0, Number(lopDays));
    if (lateLopDays !== undefined) upd.lateLopDays = Math.max(0, Number(lateLopDays));
    if (paymentDate !== undefined) upd.paymentDate = paymentDate ? new Date(paymentDate) : null;
    if (remarks !== undefined) upd.remarks = remarks;
    if (presentDays !== undefined) upd.presentDays = Math.max(0, Number(presentDays));
    if (leaveDays !== undefined) upd.leaveDays = Math.max(0, Number(leaveDays));
    if (presentDays !== undefined || leaveDays !== undefined) {
      if (lopDays === undefined) {
        upd.lopDays = Math.max(0, (upd.workingDays || 0) - (upd.presentDays || 0) - (upd.leaveDays || 0));
      }
    }

    const totalDaysInMonth = daysInMonthOf(upd.periodTo);
    const perDaySalary = totalDaysInMonth > 0 ? (upd.monthlyCTC || upd.grossEarnings || 0) / totalDaysInMonth : 0;
    upd.lopDeduction = roundTwo(Math.max(0, upd.lopDays || 0) * perDaySalary);
    upd.lateDeduction = roundTwo(Math.max(0, upd.lateLopDays || 0) * perDaySalary);
    const tds = upd.tds || 0;
    const pt = upd.professionalTax || 0;
    upd.totalDeductions = roundTwo((upd.employerEPF || 0) + (upd.employeeEPF || 0) + upd.lopDeduction + upd.lateDeduction + tds + pt);
    upd.netTakeHome = roundTwo(Math.max(0, (upd.grossEarnings || 0) - upd.totalDeductions));
    upd.netPay = upd.netTakeHome;
    upd.updatedAt = new Date();

    await collections.salarySlips().updateOne({ _id: slipId }, { $set: upd });
    const fresh = await collections.salarySlips().findOne({ _id: slipId });
    return fresh;
  }, PayrollSchemas.Update)

  // ─── Delete slip (admin) ──────────────────────────────────────────────────
  .delete('/:id', async ({ user, params, body, set }) => {
    if (user?.role !== 'admin') { set.status = 403; return { message: 'Forbidden' }; }
    const slipId = oid(params.id);
    if (!slipId) { set.status = 400; return { message: 'Invalid slip id' }; }
    const slip = await collections.salarySlips().findOne({ _id: slipId });
    if (!slip) { set.status = 404; return { message: 'Salary slip not found' }; }
    if (slip.status === 'finalized') {
      const token = String((body as any)?.confirm || '').trim().toLowerCase();
      if (token !== 'delete') {
        set.status = 400;
        return {
          message: 'Finalized slip deletion requires typed confirmation. Send { confirm: "delete" } in the request body.',
          code: 'CONFIRM_REQUIRED',
        };
      }
    }
    await collections.salarySlips().deleteOne({ _id: slipId });
    return { message: slip.status === 'finalized' ? 'Finalized slip deleted' : 'Draft slip deleted' };
  }, PayrollSchemas.Delete)

  // ─── Finalize one (admin) ─────────────────────────────────────────────────
  .post('/:id/finalize', async ({ user, params, set }) => {
    if (user?.role !== 'admin') { set.status = 403; return { message: 'Forbidden' }; }
    const slipId = oid(params.id);
    if (!slipId) { set.status = 400; return { message: 'Invalid slip id' }; }
    const slip = await collections.salarySlips().findOne({ _id: slipId });
    if (!slip) { set.status = 404; return { message: 'Salary slip not found' }; }
    if (slip.status === 'finalized') { set.status = 400; return { message: 'Already finalized' }; }

    const adminEmpOid = user?.employeeId ? oid(user.employeeId) : null;
    await collections.salarySlips().updateOne({ _id: slipId }, {
      $set: { status: 'finalized', finalizedBy: adminEmpOid || undefined, finalizedAt: new Date(), updatedAt: new Date() },
    });

    const monthName = new Date(slip.year!, (slip.month || 1) - 1, 1).toLocaleString('default', { month: 'long' });
    await notifySlipFinalized({ employee: slip.employee, netPay: slip.netPay }, monthName, slip.year!);

    return await collections.salarySlips().findOne({ _id: slipId });
  }));
