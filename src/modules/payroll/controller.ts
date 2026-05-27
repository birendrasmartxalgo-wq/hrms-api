import { Elysia } from 'elysia';
import { ObjectId } from 'mongodb';
import { authPlugin } from '../../plugins/auth';
import { collections } from '../../db/collections';
import { PayrollSchemas } from './schema';
import {
  IFSC_RE, validateConfig,
  populateSlip, populateSlipsList,
  daysInMonthOf, roundTwo,
} from './service';
import { buildSalarySlipPdf } from './pdf';
import { oid, notifySlipFinalized } from './helpers';

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

  // Note: batch + export routes (generate, import-excel, finalize-all, bulk-*,
  // export-*) live in adminController.ts under /admin/payroll/* — see
  // docs/api-spec/modules/02-admin.md.

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
