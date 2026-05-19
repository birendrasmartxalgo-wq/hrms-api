import type { Db } from 'mongodb';

// Tolerate IndexOptionsConflict (85) and IndexKeySpecsConflict (86) — the DB
// may already carry equivalent indexes under different names from the legacy
// Mongoose schema. Bubble anything else.
async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err: any) {
    const code = err?.code ?? err?.errorResponse?.code;
    if (code === 85 || code === 86 || code === 86001) {
      console.warn(`[ensureIndexes] tolerated existing index conflict (code ${code}): ${err?.message ?? err}`);
      return null;
    }
    throw err;
  }
}

export async function ensureIndexes(db: Db) {
  await Promise.all([
    safe(db.collection('users').createIndexes([
      { key: { email: 1 }, unique: true, name: 'users_email_unique' },
      { key: { employee: 1 }, sparse: true, name: 'users_employee_idx' },
      { key: { role: 1, isActive: 1 }, name: 'users_role_active_idx' },
    ])),
    safe(db.collection('employees').createIndexes([
      { key: { user: 1 }, unique: true, sparse: true, name: 'employees_user_unique' },
      { key: { empId: 1 }, unique: true, name: 'employees_empId_unique' },
    ])),
    safe(db.collection('departments').createIndexes([
      { key: { name: 1 }, unique: true, name: 'departments_name_unique' },
      { key: { code: 1 }, unique: true, name: 'departments_code_unique' },
    ])),
    safe(db.collection('attendances').createIndexes([
      { key: { employee: 1, date: 1 }, unique: true, name: 'attendances_emp_date_unique' },
      { key: { date: 1, status: 1 }, name: 'attendances_date_status_idx' },
    ])),
    safe(db.collection('repunchRequests').createIndexes([
      { key: { employee: 1, date: 1 }, name: 'repunch_emp_date_idx' },
      { key: { status: 1 }, name: 'repunch_status_idx' },
    ])),
    safe(db.collection('leaveBalances').createIndexes([
      { key: { employee: 1, year: 1 }, unique: true, name: 'leavebal_emp_year_unique' },
    ])),
    safe(db.collection('leaveRequests').createIndexes([
      { key: { employee: 1, status: 1 }, name: 'leavereq_emp_status_idx' },
      { key: { approver: 1, status: 1 }, name: 'leavereq_approver_status_idx' },
      { key: { startDate: 1, endDate: 1 }, name: 'leavereq_dates_idx' },
    ])),
    safe(db.collection('holidays').createIndexes([
      { key: { date: 1, year: 1 }, name: 'holidays_date_year_idx' },
    ])),
    safe(db.collection('tasks').createIndexes([
      { key: { assignee: 1, status: 1 }, name: 'tasks_assignee_status_idx' },
      { key: { createdBy: 1 }, name: 'tasks_createdBy_idx' },
      { key: { project: 1, status: 1 }, name: 'tasks_project_status_idx' },
      { key: { dueDate: 1 }, name: 'tasks_dueDate_idx' },
      { key: { tags: 1 }, name: 'tasks_tags_idx' },
      { key: { title: 'text', description: 'text' }, name: 'tasks_text_idx' },
    ])),
    safe(db.collection('salarySlips').createIndexes([
      { key: { employee: 1, month: 1, year: 1 }, unique: true, name: 'salaryslips_unique_idx' },
    ])),
    safe(db.collection('salaryRevisions').createIndexes([
      { key: { employee: 1, version: -1 }, name: 'salaryrev_emp_version_idx' },
      { key: { employee: 1, effectiveFrom: -1 }, name: 'salaryrev_emp_effective_idx' },
    ])),
    safe(db.collection('conversations').createIndexes([
      { key: { participants: 1 }, name: 'conversations_participants_idx' },
      { key: { 'lastMessage.timestamp': -1 }, name: 'conversations_lastmsg_idx' },
    ])),
    safe(db.collection('messages').createIndexes([
      { key: { conversation: 1, createdAt: -1 }, name: 'messages_conv_created_idx' },
    ])),
    safe(db.collection('notifications').createIndexes([
      { key: { employee: 1, createdAt: -1 }, name: 'notifications_emp_created_idx' },
      { key: { createdAt: 1 }, expireAfterSeconds: 2592000, name: 'notifications_expire_idx' }, // 30 days
    ])),
    safe(db.collection('documents').createIndexes([
      { key: { employee: 1, type: 1 }, unique: true, name: 'documents_emp_type_unique' },
    ])),
    safe(db.collection('settings').createIndexes([
      { key: { key: 1 }, unique: true, name: 'settings_key_unique' },
    ])),
  ]);
}
