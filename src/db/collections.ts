import type { Collection } from 'mongodb';
import { getDb } from './client';
import type { UserDocument } from './types/User';
import type { EmployeeDocument } from './types/Employee';
import type { DepartmentDocument } from './types/Department';
import type { AttendanceDocument } from './types/Attendance';
import type { RepunchRequestDocument } from './types/RepunchRequest';
import type { LeavePolicyDocument, LeaveBalanceDocument, LeaveRequestDocument, HolidayDocument } from './types/Leave';
import type { TaskDocument } from './types/Task';
import type { SalarySlipDocument } from './types/SalarySlip';
import type { SalaryRevisionDocument } from './types/SalaryRevision';
import type { ConversationDocument } from './types/Conversation';
import type { MessageDocument } from './types/Message';
import type { NotificationDocument } from './types/Notification';
import type { AnnouncementDocument } from './types/Announcement';
import type { DocumentRecordDocument } from './types/Document';
import type { SettingsDocument } from './types/Settings';

export const collections = {
  users(): Collection<UserDocument> { return getDb().collection<UserDocument>('users'); },
  employees(): Collection<EmployeeDocument> { return getDb().collection<EmployeeDocument>('employees'); },
  departments(): Collection<DepartmentDocument> { return getDb().collection<DepartmentDocument>('departments'); },
  attendances(): Collection<AttendanceDocument> { return getDb().collection<AttendanceDocument>('attendances'); },
  repunchRequests(): Collection<RepunchRequestDocument> { return getDb().collection<RepunchRequestDocument>('repunchRequests'); },
  leavePolicies(): Collection<LeavePolicyDocument> { return getDb().collection<LeavePolicyDocument>('leavePolicies'); },
  leaveBalances(): Collection<LeaveBalanceDocument> { return getDb().collection<LeaveBalanceDocument>('leaveBalances'); },
  leaveRequests(): Collection<LeaveRequestDocument> { return getDb().collection<LeaveRequestDocument>('leaveRequests'); },
  holidays(): Collection<HolidayDocument> { return getDb().collection<HolidayDocument>('holidays'); },
  tasks(): Collection<TaskDocument> { return getDb().collection<TaskDocument>('tasks'); },
  salarySlips(): Collection<SalarySlipDocument> { return getDb().collection<SalarySlipDocument>('salarySlips'); },
  salaryRevisions(): Collection<SalaryRevisionDocument> { return getDb().collection<SalaryRevisionDocument>('salaryRevisions'); },
  conversations(): Collection<ConversationDocument> { return getDb().collection<ConversationDocument>('conversations'); },
  messages(): Collection<MessageDocument> { return getDb().collection<MessageDocument>('messages'); },
  notifications(): Collection<NotificationDocument> { return getDb().collection<NotificationDocument>('notifications'); },
  announcements(): Collection<AnnouncementDocument> { return getDb().collection<AnnouncementDocument>('announcements'); },
  documents(): Collection<DocumentRecordDocument> { return getDb().collection<DocumentRecordDocument>('documents'); },
  settings(): Collection<SettingsDocument> { return getDb().collection<SettingsDocument>('settings'); },
};
