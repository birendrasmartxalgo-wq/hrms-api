import { t } from 'elysia';

export const PayrollSchemas = {
  Generate: {
    body: t.Object({
      month: t.Number({ minimum: 1, maximum: 12 }),
      year: t.Number({ minimum: 2000, maximum: 2100 }),
      employeeIds: t.Optional(t.Array(t.String())),
      paymentDate: t.Optional(t.String()),
      finalizeAfter: t.Optional(t.Boolean()),
      preFillPresent: t.Optional(t.Boolean()),
    }),
  },
  List: {
    query: t.Object({
      month: t.Optional(t.String()),
      year: t.Optional(t.String()),
      status: t.Optional(t.String()),
    }),
  },
  Update: {
    body: t.Partial(t.Object({
      presentDays: t.Number(),
      leaveDays: t.Number(),
      lopDays: t.Number(),
      lateLopDays: t.Number(),
      paymentDate: t.Union([t.String(), t.Null()]),
      remarks: t.String(),
    })),
  },
  Delete: {
    body: t.Optional(t.Object({ confirm: t.Optional(t.String()) })),
  },
  BulkPaymentDate: {
    body: t.Object({
      month: t.Number(),
      year: t.Number(),
      paymentDate: t.String(),
      ids: t.Optional(t.Array(t.String())),
    }),
  },
  BulkDelete: {
    body: t.Object({
      month: t.Optional(t.Number()),
      year: t.Optional(t.Number()),
      ids: t.Optional(t.Array(t.String())),
    }),
  },
  BulkFinalize: {
    body: t.Object({ ids: t.Array(t.String(), { minItems: 1 }) }),
  },
  FinalizeAll: {
    body: t.Object({ month: t.Number(), year: t.Number() }),
  },
  Config: {
    body: t.Partial(t.Object({
      annualCTC: t.Number(),
      basicPercent: t.Number(),
      daAmount: t.Number(),
      specialAllowance: t.Number(),
      bankAccountName: t.String(),
      bankAccountNo: t.String(),
      bankName: t.String(),
      ifscCode: t.String(),
      bankAddress: t.String(),
      epfNo: t.String(),
      esiNo: t.String(),
      enableEPF: t.Boolean(),
      enableESI: t.Boolean(),
      effectiveFromMonth: t.Number(),
      effectiveFromYear: t.Number(),
    })),
  },
  ImportExcel: {
    body: t.Object({
      month: t.Numeric(),
      year: t.Numeric(),
      file: t.File({ maxSize: '10m' }),
    }),
  },
  MonthYearQuery: {
    query: t.Object({
      month: t.String(),
      year: t.String(),
    }),
  },
};
