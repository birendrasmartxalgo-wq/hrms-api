/**
 * Smoke test for the HRMS API surface.
 * - Logs in as admin / hr / employee
 * - Hits a representative endpoint per module
 * - Writes full responses to smoke-results.json
 * - Prints a PASS/FAIL summary table
 *
 * Run:  bun apps/api/_smoke/smoke-collection.ts
 */

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:6000';
const VERSION = process.env.API_VERSION ?? 'v1';
const ROOT = `${BASE}/api/${VERSION}`;

type Cred = { email: string; password: string };
const CREDS: Record<string, Cred> = {
  admin: { email: 'admin@smartxalgo.com', password: 'admin123' },
  hr: { email: 'hr@smartxalgo.com', password: 'hr123' },
  employee: { email: 'test@smartxalgo.com', password: 'password123' },
};

type Result = {
  group: string;
  name: string;
  method: string;
  url: string;
  role: string | null;
  status: number;
  ok: boolean;
  expected: number[];
  ms: number;
  body: unknown;
  error?: string;
};

const results: Result[] = [];
const tokens: Record<string, string> = {};

async function call(opts: {
  group: string;
  name: string;
  method: string;
  path: string;
  role?: keyof typeof CREDS;
  body?: unknown;
  expected?: number[];
}) {
  const expected = opts.expected ?? [200, 201];
  const url = `${ROOT}${opts.path}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.role && tokens[opts.role]) headers.Authorization = `Bearer ${tokens[opts.role]}`;

  const start = performance.now();
  let status = 0;
  let body: unknown = null;
  let error: string | undefined;
  try {
    const res = await fetch(url, {
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    status = res.status;
    const text = await res.text();
    try {
      body = JSON.parse(text);
    } catch {
      body = text.length > 500 ? text.slice(0, 500) + '…' : text;
    }
  } catch (e: any) {
    error = e?.message ?? String(e);
  }
  const ms = Math.round(performance.now() - start);
  const ok = !error && expected.includes(status);
  results.push({
    group: opts.group,
    name: opts.name,
    method: opts.method,
    url,
    role: opts.role ?? null,
    status,
    ok,
    expected,
    ms,
    body,
    error,
  });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${opts.method.padEnd(6)} ${opts.path.padEnd(45)} → ${status} (${ms}ms)`);
  return { ok, status, body };
}

async function login(role: keyof typeof CREDS) {
  const c = CREDS[role];
  const r = await call({
    group: 'Auth',
    name: `login (${role})`,
    method: 'POST',
    path: '/auth/login',
    body: c,
  });
  if (r.ok && r.body && typeof r.body === 'object') {
    const b = r.body as any;
    const token = b.accessToken ?? b.token ?? b.data?.accessToken;
    if (token) tokens[role] = token;
  }
}

// ---------- run ----------
const t0 = Date.now();
console.log(`Smoke test against ${ROOT}\n`);

// Health (public)
await call({ group: 'Health', name: 'health', method: 'GET', path: '/health' });
await call({
  group: 'Config',
  name: 'mobile-version',
  method: 'GET',
  path: '/config/mobile-version',
});

// Auth
await login('admin');
await login('hr');
await login('employee');
await call({ group: 'Auth', name: 'me (admin)', method: 'GET', path: '/auth/me', role: 'admin' });
await call({
  group: 'Auth',
  name: 'me (employee)',
  method: 'GET',
  path: '/auth/me',
  role: 'employee',
});

// Profile
await call({
  group: 'Profile',
  name: 'profile/me (employee)',
  method: 'GET',
  path: '/profile/me',
  role: 'employee',
});
await call({
  group: 'Profile',
  name: 'profile/documents',
  method: 'GET',
  path: '/profile/documents',
  role: 'employee',
});

// Attendance
await call({
  group: 'Attendance',
  name: 'today',
  method: 'GET',
  path: '/attendance/today',
  role: 'employee',
});
await call({
  group: 'Attendance',
  name: 'monthly',
  method: 'GET',
  path: '/attendance/monthly',
  role: 'employee',
});
await call({
  group: 'Attendance',
  name: 'repunch-status',
  method: 'GET',
  path: '/attendance/repunch-status',
  role: 'employee',
});
await call({
  group: 'Attendance',
  name: 'repunch-requests (admin)',
  method: 'GET',
  path: '/attendance/repunch-requests',
  role: 'admin',
});
await call({
  group: 'Attendance',
  name: 'activity-statuses (admin)',
  method: 'GET',
  path: '/attendance/activity-statuses',
  role: 'admin',
});

// Employees / Admin
await call({
  group: 'Employees',
  name: 'list (admin)',
  method: 'GET',
  path: '/employees',
  role: 'admin',
});
await call({
  group: 'Employees',
  name: 'stats (admin)',
  method: 'GET',
  path: '/employees/stats',
  role: 'admin',
});
await call({
  group: 'Employees',
  name: 'pending-approvals (admin)',
  method: 'GET',
  path: '/employees/pending-approvals',
  role: 'admin',
});
await call({
  group: 'Admin',
  name: 'dashboard',
  method: 'GET',
  path: '/admin/dashboard',
  role: 'admin',
});
await call({
  group: 'Admin',
  name: 'departments',
  method: 'GET',
  path: '/admin/departments',
  role: 'admin',
});
await call({
  group: 'Admin',
  name: 'office-settings',
  method: 'GET',
  path: '/admin/office-settings',
  role: 'admin',
});
await call({
  group: 'Admin',
  name: 'attendance-settings',
  method: 'GET',
  path: '/admin/attendance-settings',
  role: 'admin',
});
await call({
  group: 'Admin',
  name: 'payroll-period-settings',
  method: 'GET',
  path: '/admin/payroll-period-settings',
  role: 'admin',
});

// Tasks
await call({
  group: 'Tasks',
  name: 'list',
  method: 'GET',
  path: '/tasks',
  role: 'employee',
});
await call({
  group: 'Tasks',
  name: 'stats',
  method: 'GET',
  path: '/tasks/stats',
  role: 'employee',
});
await call({
  group: 'Tasks',
  name: 'kanban',
  method: 'GET',
  path: '/tasks/kanban',
  role: 'employee',
});

// Chat
await call({
  group: 'Chat',
  name: 'conversations',
  method: 'GET',
  path: '/chat',
  role: 'employee',
});
await call({
  group: 'Chat',
  name: 'online',
  method: 'GET',
  path: '/chat/online',
  role: 'employee',
});
await call({
  group: 'Chat',
  name: 'starred',
  method: 'GET',
  path: '/chat/starred',
  role: 'employee',
});

// Leaves
await call({
  group: 'Leaves',
  name: 'my',
  method: 'GET',
  path: '/leaves/my',
  role: 'employee',
});
await call({
  group: 'Leaves',
  name: 'balance',
  method: 'GET',
  path: '/leaves/balance',
  role: 'employee',
});
await call({
  group: 'Leaves',
  name: 'pending (admin)',
  method: 'GET',
  path: '/leaves/pending',
  role: 'admin',
});
await call({
  group: 'Leaves',
  name: 'summary (admin)',
  method: 'GET',
  path: '/leaves/summary',
  role: 'admin',
});

// Notifications
await call({
  group: 'Notifications',
  name: 'list',
  method: 'GET',
  path: '/notifications',
  role: 'employee',
});

// Announcements
await call({
  group: 'Announcements',
  name: 'list',
  method: 'GET',
  path: '/announcements?limit=5',
  role: 'employee',
});

// Payroll
await call({
  group: 'Payroll',
  name: 'my',
  method: 'GET',
  path: '/payroll/my',
  role: 'employee',
});
await call({
  group: 'Payroll',
  name: 'list (admin)',
  method: 'GET',
  path: '/payroll',
  role: 'admin',
});
await call({
  group: 'Payroll',
  name: 'export-template (admin)',
  method: 'GET',
  path: '/payroll/export-template',
  role: 'admin',
});

// Auth-required negative check
await call({
  group: 'Auth',
  name: 'me (no token → 401)',
  method: 'GET',
  path: '/auth/me',
  expected: [401],
});

// ---------- summary ----------
const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
const totalMs = Date.now() - t0;

console.log('\n──────────────────────── SUMMARY ────────────────────────');
console.log(`Total: ${results.length}   PASS: ${passed}   FAIL: ${failed}   (${totalMs}ms)\n`);

const byGroup = new Map<string, { pass: number; fail: number }>();
for (const r of results) {
  const g = byGroup.get(r.group) ?? { pass: 0, fail: 0 };
  if (r.ok) g.pass += 1;
  else g.fail += 1;
  byGroup.set(r.group, g);
}
console.log('Group              Pass   Fail');
for (const [g, c] of byGroup) {
  console.log(`${g.padEnd(18)} ${String(c.pass).padStart(4)}   ${String(c.fail).padStart(4)}`);
}

if (failed > 0) {
  console.log('\nFailed endpoints:');
  for (const r of results.filter((x) => !x.ok)) {
    console.log(
      `  - [${r.method}] ${r.url}  → ${r.status || 'ERR'} ${r.error ?? ''}`,
    );
  }
}

const outPath = new URL('./smoke-results.json', import.meta.url);
await Bun.write(
  outPath,
  JSON.stringify(
    {
      target: ROOT,
      ranAt: new Date().toISOString(),
      durationMs: totalMs,
      totals: { total: results.length, passed, failed },
      results,
    },
    null,
    2,
  ),
);
console.log(`\nFull responses written to: ${outPath.pathname.replace(/^\//, '')}`);

process.exit(failed === 0 ? 0 : 1);
