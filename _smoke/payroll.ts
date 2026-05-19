import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId } from 'mongodb';
import * as XLSX from 'xlsx';

process.env.JWT_SECRET = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.NODE_ENV = 'test';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'test';
process.env.AWS_SECRET_ACCESS_KEY = 'test';
process.env.S3_BUCKET = 'test-bucket';
process.env.S3_REGION = 'us-east-1';

const { Elysia } = await import('elysia');
const { env } = await import('../src/env');
const { payrollController } = await import('../src/modules/payroll/controller');
const { authController } = await import('../src/modules/auth/controller');
const { errorPlugin } = await import('../src/plugins/error');
const app = new Elysia({ prefix: `/api/${env.API_VERSION}` })
  .use(errorPlugin)
  .use(authController)
  .use(payrollController);
const { connectDb } = await import('../src/db/client');
const { collections } = await import('../src/db/collections');
const {
  calcSalaryComponents,
  getSalaryPeriod,
  daysInMonthOf,
} = await import('../src/modules/payroll/service');
const { buildSalarySlipPdf } = await import('../src/modules/payroll/pdf');

function makeAdminToken(userId: string) {
  // Use the actual app's JWT signing — easier: call /auth/login. But for this test
  // we just rely on register → admin auto-promote path. Simpler: register first user
  // (admin@smartxalgo.com is auto-admin in legacy). We'll instead manually create a
  // user with role:admin and mint a JWT via the auth controller's helper if exposed.
  return userId; // placeholder
}

function assert(cond: any, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main() {
  const replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  env.MONGO_URI = replset.getUri();
  await connectDb();

  // ─── 1. UNIT: salary component math ───────────────────────────────────────
  console.log('─── Test 1: salary math ────────────────────────────────────────');
  const comps = calcSalaryComponents(
    { annualCTC: 600000, basicPercent: 50, daAmount: 0, enableEPF: true },
    22, 22, 0, undefined, 0, 30,
  );
  assert(comps.monthlyCTC === 50000, `monthlyCTC expected 50000 got ${comps.monthlyCTC}`);
  assert(comps.basic === 25000, `basic expected 25000 got ${comps.basic}`);
  assert(comps.hra === 10000, `hra expected 10000 got ${comps.hra}`);
  assert(comps.employerEPF === 3000, `employerEPF expected 3000 got ${comps.employerEPF}`);
  assert(comps.employeeEPF === 3000, `employeeEPF expected 3000 got ${comps.employeeEPF}`);
  assert(comps.specialAllowance === 15000, `specialAllowance expected 15000 got ${comps.specialAllowance}`);
  // Total earnings == monthlyCTC (invariant)
  const totalEarnings = comps.basic + comps.hra + comps.da + comps.specialAllowance;
  assert(Math.abs(totalEarnings - comps.grossEarnings) < 0.01, `totalEarnings ${totalEarnings} != grossEarnings ${comps.grossEarnings}`);
  // TDS @ 6L annual: taxable = 600k - 75k - 36k = 489k → < 12L → 0 tax
  assert(comps.tds === 0, `tds expected 0 (taxable < 12L), got ${comps.tds}`);
  console.log('  ✓ math invariants hold');

  // ─── 2. UNIT: salary period ───────────────────────────────────────────────
  console.log('─── Test 2: salary period ──────────────────────────────────────');
  const { periodFrom, periodTo } = getSalaryPeriod(11, 2025, { startDay: 21, endDay: 20 });
  // Nov 2025 period (21st Oct → 20th Nov)
  assert(periodFrom.getMonth() === 9 && periodFrom.getDate() === 21, `periodFrom wrong: ${periodFrom.toISOString()}`);
  assert(periodTo.getMonth() === 10 && periodTo.getDate() === 20, `periodTo wrong: ${periodTo.toISOString()}`);
  assert(daysInMonthOf(periodTo) === 30, `Nov has 30 days, got ${daysInMonthOf(periodTo)}`);
  console.log('  ✓ period 21-Oct → 20-Nov correctly computed');

  // ─── 3. PDF: structural verification ──────────────────────────────────────
  console.log('─── Test 3: PDF structural ─────────────────────────────────────');
  const slipForPdf = {
    month: 11, year: 2025,
    periodFrom, periodTo,
    paymentDate: new Date('2025-11-30'),
    workingDays: 22, leaveDays: 0,
    basic: 25000, hra: 10000, da: 0, specialAllowance: 15000,
    employerEPF: 3000, employeeEPF: 3000, tds: 0, professionalTax: 200,
    lopDays: 0, lopDeduction: 0, lateLopDays: 0, lateDeduction: 0, lateCount: 0,
    bankAccountName: 'John Doe', bankAccountNo: '123456789012',
    bankName: 'Test Bank', bankAddress: '1 Test Ln', ifscCode: 'SBIN0001786',
    epfNo: '123456789012', esiNo: 'NA',
    employee: { name: 'John Doe', empId: 'EMP-001', designation: 'Engineer', department: { name: 'Engineering' } },
  };
  const pdfBuf = await buildSalarySlipPdf(slipForPdf as any);
  assert(pdfBuf.length > 1000, `PDF unexpectedly small: ${pdfBuf.length} bytes`);
  assert(pdfBuf.slice(0, 4).toString() === '%PDF', `not a valid PDF: starts with ${pdfBuf.slice(0, 4).toString()}`);
  // pdfkit puts text in compressed streams; we can still grep for ascii fragments
  // that appear unencoded in the catalog/trailer. Instead, check % markers + size.
  // Minimum sanity: contains 'Helvetica' font reference & 'PDF' trailer.
  const tail = pdfBuf.slice(-1024).toString('latin1');
  assert(tail.includes('%%EOF'), `PDF missing %%EOF trailer`);
  console.log(`  ✓ PDF generated: ${pdfBuf.length} bytes, valid header + trailer`);

  // ─── 4. E2E: register admin, generate via API, finalize, download PDF ─────
  console.log('─── Test 4: end-to-end payroll ─────────────────────────────────');

  // Register first user (becomes admin per legacy convention — check our auth)
  const regRes = await app.handle(new Request('http://localhost/api/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@smartxalgo.com', password: 'password123', name: 'Admin' }),
  }));
  if (!regRes.ok) {
    const t = await regRes.text();
    throw new Error(`register failed: ${regRes.status} ${t}`);
  }
  const regData: any = await regRes.json();
  // Promote to admin
  await collections.users().updateOne({ email: 'admin@smartxalgo.com' }, { $set: { role: 'admin' } });

  // Login to get fresh token with admin role
  const loginRes = await app.handle(new Request('http://localhost/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@smartxalgo.com', password: 'password123' }),
  }));
  if (!loginRes.ok) throw new Error(`login failed: ${loginRes.status} ${await loginRes.text()}`);
  const loginData: any = await loginRes.json();
  const adminToken = loginData.token || loginData.accessToken;
  assert(adminToken, 'no admin token from login');

  // Seed 50 employees with CTC
  console.log('  seeding 50 employees with CTC=480000…');
  const adminUser = await collections.users().findOne({ email: 'admin@smartxalgo.com' });
  const empDocs = [];
  for (let i = 1; i <= 50; i++) {
    const empOid = new ObjectId();
    const userOid = new ObjectId();
    await collections.users().insertOne({
      _id: userOid,
      email: `emp${i}@test.com`,
      password: 'x',
      name: `Emp ${i}`,
      role: 'employee',
      isActive: true,
      employee: empOid,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
    empDocs.push({
      _id: empOid,
      empId: `E${String(i).padStart(3, '0')}`,
      name: `Emp ${i}`,
      designation: 'Engineer',
      user: userOid,
      isActive: true,
      onboardingStatus: 'approved',
      annualCTC: 480000,
      basicPercent: 50,
      daAmount: 0,
      enableEPF: false,
      enableESI: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  await collections.employees().insertMany(empDocs as any);

  // Build a 50-row xlsx
  console.log('  building 50-row xlsx…');
  const rows = [['empId', 'presentDays', 'leaveDays']];
  for (let i = 1; i <= 50; i++) {
    rows.push([`E${String(i).padStart(3, '0')}`, '22', '0']);
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Import');
  const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  const fd = new FormData();
  fd.append('month', '11');
  fd.append('year', '2025');
  fd.append('file', new Blob([xlsxBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'import.xlsx');

  const importRes = await app.handle(new Request('http://localhost/api/v1/payroll/import-excel', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: fd,
  }));
  if (!importRes.ok) throw new Error(`import failed: ${importRes.status} ${await importRes.text()}`);
  const importData: any = await importRes.json();
  console.log(`  import: ${importData.results.updated.length} updated, ${importData.results.skipped.length} skipped, ${importData.results.errors.length} errors`);
  assert(importData.results.updated.length === 50, `expected 50 updated, got ${importData.results.updated.length}`);

  const drafts = await collections.salarySlips().countDocuments({ month: 11, year: 2025, status: 'draft' });
  assert(drafts === 50, `expected 50 draft slips, got ${drafts}`);
  console.log(`  ✓ 50 draft slips created in DB`);

  // PDF download for one of them
  const oneSlip = await collections.salarySlips().findOne({ month: 11, year: 2025 });
  assert(oneSlip, 'no slip found');
  const pdfRes = await app.handle(new Request(`http://localhost/api/v1/payroll/${oneSlip!._id.toHexString()}/pdf`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  }));
  if (!pdfRes.ok) throw new Error(`pdf download failed: ${pdfRes.status} ${await pdfRes.text()}`);
  const downloaded = Buffer.from(await pdfRes.arrayBuffer());
  assert(downloaded.slice(0, 4).toString() === '%PDF', `downloaded not a PDF: ${downloaded.slice(0, 4).toString()}`);
  assert(downloaded.length > 1000, `downloaded PDF too small: ${downloaded.length}`);
  console.log(`  ✓ PDF endpoint returned ${downloaded.length} bytes`);

  console.log('\n✅ All payroll smoke tests passed');
  await replset.stop();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ FAILED:', err);
    process.exit(1);
  });
