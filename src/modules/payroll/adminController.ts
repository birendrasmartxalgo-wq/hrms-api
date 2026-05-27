import { Elysia } from 'elysia';
import { ObjectId } from 'mongodb';
import { authPlugin } from '../../plugins/auth';
import { collections } from '../../db/collections';
import { putObject, buildUploadKey } from '../../services/s3';
import { PayrollSchemas } from './schema';
import {
  getSalaryPeriod, daysInMonthOf, getWorkingDaysList, calcWorkingDays,
  calcPresentDays, calcApprovedLeaveDays, calcLateCount, calcLateLopDays,
  calcSalaryComponents, roundTwo, populateSlipsList,
} from './service';
import { parseImportBuffer, exportTemplate, exportBankStatement, exportEPFOStatement, exportWorkingDays, fileNameForMonth } from './excel';
import { XLSX_MIME, oid, getPayrollPeriodConfig, notifySlipFinalized } from './helpers';

// Operator-surface payroll routes. See docs/api-spec/modules/02-admin.md.
// Per-slip mutations (PATCH/DELETE /payroll/:id, /:id/finalize) stay on the
// resource — they're row-level state transitions, not batch operations.
export const payrollAdminController = new Elysia({ prefix: '/admin/payroll' })
  .use(authPlugin)
  .guard({ authorize: true as const }, app => app

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
  }, PayrollSchemas.BulkDelete));
