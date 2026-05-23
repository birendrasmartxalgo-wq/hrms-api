import type { Collection, Db, IndexDescription } from 'mongodb';

function isTextIndex(key: Record<string, any>) {
  return Object.values(key).includes('text');
}

async function ensure(collection: Collection, desired: IndexDescription[]) {
  const existing = await collection.listIndexes().toArray();
  const existingKeys = existing.map((idx) => JSON.stringify(idx.key));
  const hasTextIndex = existing.some((idx) => idx.key && '_fts' in idx.key);

  const toCreate = desired.filter((idx) => {
    if (isTextIndex(idx.key as Record<string, any>)) return !hasTextIndex;
    return !existingKeys.includes(JSON.stringify(idx.key));
  });

  if (toCreate.length === 0) return;

  try {
    await collection.createIndexes(toCreate);
  } catch (err: any) {
    const code = err?.code ?? err?.errorResponse?.code;
    if (code === 85 || code === 86 || code === 86001) {
      console.warn(
        `[ensureIndexes] tolerated existing index conflict (code ${code}): ${err?.message ?? err}`,
      );
      return;
    }
    throw err;
  }
}

export async function ensureIndexes(db: Db) {
  await Promise.all([
    ensure(db.collection('users'), [
      { key: { email: 1 }, unique: true, name: 'users_email_unique' },
      { key: { employee: 1 }, sparse: true, name: 'users_employee_idx' },
      { key: { role: 1, isActive: 1 }, name: 'users_role_active_idx' },
    ]),
    ensure(db.collection('employees'), [
      { key: { user: 1 }, unique: true, sparse: true, name: 'employees_user_unique' },
      { key: { empId: 1 }, unique: true, name: 'employees_empId_unique' },
    ]),
    ensure(db.collection('departments'), [
      { key: { name: 1 }, unique: true, name: 'departments_name_unique' },
      { key: { code: 1 }, unique: true, name: 'departments_code_unique' },
    ]),
    ensure(db.collection('attendances'), [
      { key: { employee: 1, date: 1 }, unique: true, name: 'attendances_emp_date_unique' },
      { key: { date: 1, status: 1 }, name: 'attendances_date_status_idx' },
    ]),
    ensure(db.collection('repunchRequests'), [
      { key: { employee: 1, date: 1 }, name: 'repunch_emp_date_idx' },
      { key: { status: 1 }, name: 'repunch_status_idx' },
    ]),
    ensure(db.collection('leaveBalances'), [
      { key: { employee: 1, year: 1 }, unique: true, name: 'leavebal_emp_year_unique' },
    ]),
    ensure(db.collection('leaveRequests'), [
      { key: { employee: 1, status: 1 }, name: 'leavereq_emp_status_idx' },
      { key: { approver: 1, status: 1 }, name: 'leavereq_approver_status_idx' },
      { key: { startDate: 1, endDate: 1 }, name: 'leavereq_dates_idx' },
    ]),
    ensure(db.collection('holidays'), [
      { key: { date: 1, year: 1 }, name: 'holidays_date_year_idx' },
    ]),
    ensure(db.collection('tasks'), [
      { key: { assignee: 1, status: 1 }, name: 'tasks_assignee_status_idx' },
      { key: { createdBy: 1 }, name: 'tasks_createdBy_idx' },
      { key: { project: 1, status: 1 }, name: 'tasks_project_status_idx' },
      { key: { dueDate: 1 }, name: 'tasks_dueDate_idx' },
      { key: { tags: 1 }, name: 'tasks_tags_idx' },
      { key: { title: 'text', description: 'text' }, name: 'tasks_text_idx' },
    ]),
    ensure(db.collection('salarySlips'), [
      { key: { employee: 1, month: 1, year: 1 }, unique: true, name: 'salaryslips_unique_idx' },
    ]),
    ensure(db.collection('salaryRevisions'), [
      { key: { employee: 1, version: -1 }, name: 'salaryrev_emp_version_idx' },
      { key: { employee: 1, effectiveFrom: -1 }, name: 'salaryrev_emp_effective_idx' },
    ]),
    ensure(db.collection('conversations'), [
      { key: { participants: 1 }, name: 'conversations_participants_idx' },
      { key: { 'lastMessage.timestamp': -1 }, name: 'conversations_lastmsg_idx' },
    ]),
    ensure(db.collection('messages'), [
      { key: { conversation: 1, createdAt: -1 }, name: 'messages_conv_created_idx' },
    ]),
    ensure(db.collection('notifications'), [
      { key: { employee: 1, createdAt: -1 }, name: 'notifications_emp_created_idx' },
      { key: { createdAt: 1 }, expireAfterSeconds: 2592000, name: 'notifications_expire_idx' },
    ]),
    ensure(db.collection('documents'), [
      { key: { employee: 1, type: 1 }, unique: true, name: 'documents_emp_type_unique' },
    ]),
    ensure(db.collection('settings'), [
      { key: { key: 1 }, unique: true, name: 'settings_key_unique' },
    ]),
  ]);
}
