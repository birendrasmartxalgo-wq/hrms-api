import { t } from 'elysia';

// Slim view of an employee row returned by the list endpoint. The full
// EmployeeDocument has many more fields; mobile + web only need this subset
// to render directory/team/employees rows. additionalProperties:true keeps
// extra server-side fields (timestamps, bank info, etc.) from being stripped
// by validation when present on the cursor objects.
export const EmployeeListItem = t.Object(
  {
    _id: t.Any(),
    empId: t.Optional(t.String()),
    name: t.String(),
    email: t.Optional(t.String()),
    designation: t.Optional(t.String()),
    // Department is either a plain string id, a populated {_id, name} object,
    // or null for unassigned. Mobile renders the name when available.
    department: t.Optional(
      t.Union([
        t.Null(),
        t.String(),
        t.Object({ _id: t.Any(), name: t.String() }, { additionalProperties: true }),
      ]),
    ),
    phone: t.Optional(t.String()),
    avatar: t.Optional(t.String()),
    employmentStatus: t.Optional(t.String()),
    isActive: t.Optional(t.Boolean()),
    // Optional — server doesn't compute this today. Mobile defaults to 'unknown'
    // until /employees joins today's attendance.
    attendanceStatus: t.Optional(
      t.Union([
        t.Literal('present'),
        t.Literal('absent'),
        t.Literal('leave'),
        t.Literal('unknown'),
      ]),
    ),
  },
  { additionalProperties: true },
);

export const EmployeeSchemas = {
  List: {
    query: t.Object({
      search: t.Optional(t.String()),
      department: t.Optional(t.String()),
      status: t.Optional(t.String()),
      employmentStatus: t.Optional(t.String()),
      onboardingStatus: t.Optional(t.String()),
      tab: t.Optional(t.String()),
      page: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
    response: t.Union([
      t.Object({
        employees: t.Array(EmployeeListItem),
        total: t.Number(),
        page: t.Number(),
        limit: t.Number(),
      }),
      t.Object({ message: t.String() }),
    ]),
  },
  Detail: {
    params: t.Object({
      id: t.String(),
    }),
  },
  Create: {
    body: t.Object({
      name: t.String(),
      email: t.String(),
      password: t.String(),
      role: t.Optional(t.String()),
      department: t.Optional(t.String()),
      designation: t.Optional(t.String()),
      empId: t.Optional(t.String()),
      dateOfJoining: t.Optional(t.String()),
      reportingManager: t.Optional(t.String()),
      phone: t.Optional(t.String()),
      annualCTC: t.Optional(t.Number()),
      basicPercent: t.Optional(t.Number()),
      daAmount: t.Optional(t.Number()),
      specialAllowance: t.Optional(t.Number()),
      enableEPF: t.Optional(t.Boolean()),
      enableESI: t.Optional(t.Boolean()),
      bankAccountName: t.Optional(t.String()),
      bankAccountNo: t.Optional(t.String()),
      bankName: t.Optional(t.String()),
      bankAddress: t.Optional(t.String()),
      ifscCode: t.Optional(t.String()),
      epfNo: t.Optional(t.String()),
      esiNo: t.Optional(t.String()),
    }),
  },
  Update: {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      name: t.Optional(t.String()),
      email: t.Optional(t.String()),
      department: t.Optional(t.String()),
      designation: t.Optional(t.String()),
      empId: t.Optional(t.String()),
      dateOfJoining: t.Optional(t.String()),
      reportingManager: t.Optional(t.String()),
      employmentStatus: t.Optional(t.String()),
      dateOfLeave: t.Optional(t.String()),
      separationReason: t.Optional(t.String()),
      separationType: t.Optional(t.String()),
      phone: t.Optional(t.String()),
      emergencyContact: t.Optional(t.String()),
      address: t.Optional(t.String()),
      dateOfBirth: t.Optional(t.String()),
      bloodGroup: t.Optional(t.String()),
      personalEmail: t.Optional(t.String()),
      linkedIn: t.Optional(t.String()),
      bio: t.Optional(t.String()),
      canMarkAttendance: t.Optional(t.Boolean()),
      annualCTC: t.Optional(t.Number()),
      basicPercent: t.Optional(t.Number()),
      daAmount: t.Optional(t.Number()),
      specialAllowance: t.Optional(t.Number()),
      enableEPF: t.Optional(t.Boolean()),
      enableESI: t.Optional(t.Boolean()),
      bankAccountName: t.Optional(t.String()),
      bankAccountNo: t.Optional(t.String()),
      bankName: t.Optional(t.String()),
      bankAddress: t.Optional(t.String()),
      ifscCode: t.Optional(t.String()),
      epfNo: t.Optional(t.String()),
      esiNo: t.Optional(t.String()),
    }),
  },
  Delete: {
    params: t.Object({
      id: t.String(),
    }),
  },
  ForceLogout: {
    params: t.Object({
      id: t.String(),
    }),
  },
  Approve: {
    params: t.Object({
      empId: t.String(),
    }),
  },
  Reject: {
    params: t.Object({
      empId: t.String(),
    }),
    body: t.Object({
      reason: t.String(),
    }),
  },
  UploadDocument: {
    params: t.Object({
      id: t.String(),
    }),
  },
  DocumentsList: {
    params: t.Object({
      id: t.String(),
    }),
  },
  DocumentDetails: {
    params: t.Object({
      id: t.String(),
    }),
  },
  DeleteDocument: {
    params: t.Object({
      docId: t.String(),
    }),
  },
};
