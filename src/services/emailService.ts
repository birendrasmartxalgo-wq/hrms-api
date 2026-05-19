import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../env';

let transporter: Transporter | undefined;

async function getTransporter(): Promise<Transporter> {
  if (transporter) return transporter;

  const smtpHost = (env as any).SMTP_HOST || process.env.SMTP_HOST;
  if (smtpHost) {
    const pass = (env as any).SMTP_PASSWORD || process.env.SMTP_PASSWORD || process.env.SMTP_PASS;
    transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: (env as any).SMTP_USER || process.env.SMTP_USER,
        pass,
      },
    });
  } else {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    console.log('📧 Email: using Ethereal test account (emails visible at https://ethereal.email)');
  }
  return transporter;
}

function buildFrom() {
  if (process.env.SMTP_FROM) return process.env.SMTP_FROM;
  const name = process.env.SMTP_FROM_NAME || 'SmartX HRMS';
  const addr = process.env.SMTP_USER || 'noreply@smartxalgo.com';
  return `"${name}" <${addr}>`;
}

export async function sendMail({ to, subject, html }: { to: string; subject: string; html: string }) {
  try {
    const t = await getTransporter();
    const info = await t.sendMail({ from: buildFrom(), to, subject, html });
    if (info.messageId) {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      if (previewUrl) console.log('📧 Preview:', previewUrl);
    }
    return info;
  } catch (err) {
    console.error('Email send error:', (err as Error).message);
  }
}

const SHELL_HEADER = `
  <div style="background:linear-gradient(135deg,#6366f1,#4f46e5);padding:24px;border-radius:16px 16px 0 0;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:22px;">SmartX HRMS</h1>
  </div>`;

const SHELL = (inner: string, headerOverride?: string) => `
  <div style="font-family:'DM Sans',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:20px;">
    ${headerOverride ?? SHELL_HEADER}
    <div style="background:#fff;padding:24px;border-radius:0 0 16px 16px;">${inner}</div>
  </div>`;

export function taskAssignedEmail(task: any, assigneeName: string, assigneeEmail: string, assignerName: string) {
  return sendMail({
    to: assigneeEmail,
    subject: `[SmartX] New Task Assigned: ${task.title}`,
    html: SHELL(`
      <h2 style="color:#0f172a;margin:0 0 12px;">New Task Assigned</h2>
      <p style="color:#64748b;">Hi ${assigneeName}, a new task has been assigned to you by <strong>${assignerName}</strong>.</p>
      <div style="background:#f8fafc;border-radius:12px;padding:16px;margin:16px 0;">
        <p style="margin:4px 0;"><strong>Title:</strong> ${task.title}</p>
        <p style="margin:4px 0;"><strong>Priority:</strong> ${task.priority || 'Medium'}</p>
        <p style="margin:4px 0;"><strong>Due Date:</strong> ${task.dueDate ? new Date(task.dueDate).toLocaleDateString('en-IN') : 'No due date'}</p>
        ${task.description ? `<p style="margin:4px 0;"><strong>Description:</strong> ${task.description}</p>` : ''}
      </div>`),
  });
}

export function taskStatusEmail(task: any, recipientName: string, recipientEmail: string, updaterName: string, oldStatus: string, newStatus: string) {
  return sendMail({
    to: recipientEmail,
    subject: `[SmartX] Task Updated: ${task.title} → ${newStatus.replace('_', ' ')}`,
    html: SHELL(`
      <h2 style="color:#0f172a;margin:0 0 12px;">Task Status Updated</h2>
      <p style="color:#64748b;">Hi ${recipientName}, <strong>${updaterName}</strong> updated the task status.</p>
      <div style="background:#f8fafc;border-radius:12px;padding:16px;margin:16px 0;">
        <p style="margin:4px 0;"><strong>Task:</strong> ${task.title}</p>
        <p style="margin:4px 0;"><strong>Status:</strong> ${oldStatus.replace('_', ' ')} → <strong>${newStatus.replace('_', ' ')}</strong></p>
      </div>`),
  });
}

export function taskReminderEmail(task: any, recipientName: string, recipientEmail: string, reminderType: 'overdue' | 'upcoming') {
  const isOverdue = reminderType === 'overdue';
  const header = `
    <div style="background:${isOverdue ? '#ef4444' : 'linear-gradient(135deg,#6366f1,#4f46e5)'};padding:24px;border-radius:16px 16px 0 0;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:22px;">SmartX HRMS</h1>
    </div>`;
  return sendMail({
    to: recipientEmail,
    subject: `[SmartX] ${isOverdue ? 'OVERDUE' : 'Upcoming'} Task: ${task.title}`,
    html: SHELL(`
      <h2 style="color:${isOverdue ? '#ef4444' : '#0f172a'};margin:0 0 12px;">${isOverdue ? 'Task Overdue!' : 'Task Due Soon'}</h2>
      <p style="color:#64748b;">Hi ${recipientName}, your task "${task.title}" is ${isOverdue ? 'overdue' : 'due soon'}.</p>
      <div style="background:#f8fafc;border-radius:12px;padding:16px;margin:16px 0;">
        <p style="margin:4px 0;"><strong>Due Date:</strong> ${task.dueDate ? new Date(task.dueDate).toLocaleDateString('en-IN') : '-'}</p>
        <p style="margin:4px 0;"><strong>Priority:</strong> ${task.priority}</p>
        <p style="margin:4px 0;"><strong>Status:</strong> ${(task.status || '').replace('_', ' ')}</p>
      </div>`, header),
  });
}

export function passwordResetOtpEmail(toEmail: string, recipientName: string, otp: string, expiryMinutes: number) {
  return sendMail({
    to: toEmail,
    subject: '[SmartX] Your password reset code',
    html: SHELL(`
      <h2 style="color:#0f172a;margin:0 0 12px;">Password reset request</h2>
      <p style="color:#475569;margin:0 0 16px;">Hi ${recipientName || 'there'}, use the code below to reset your SmartX HRMS password.</p>
      <div style="background:#f1f5f9;border-radius:12px;padding:20px;text-align:center;margin:18px 0;">
        <div style="font-size:34px;font-weight:700;letter-spacing:10px;color:#4f46e5;font-family:'Courier New',monospace;">${otp}</div>
      </div>
      <p style="color:#64748b;font-size:14px;margin:0 0 8px;">This code expires in <strong>${expiryMinutes} minutes</strong>. You have 3 attempts to enter it correctly.</p>
      <p style="color:#94a3b8;font-size:13px;margin-top:18px;">If you didn't request this, you can safely ignore this email — your password will stay the same.</p>`),
  });
}

export function passwordResetConfirmedEmail(toEmail: string, recipientName: string) {
  return sendMail({
    to: toEmail,
    subject: '[SmartX] Your password was changed',
    html: SHELL(`
      <h2 style="color:#0f172a;margin:0 0 12px;">Password changed successfully</h2>
      <p style="color:#475569;">Hi ${recipientName || 'there'}, your password was just updated. All previous sessions have been signed out.</p>
      <p style="color:#ef4444;font-size:14px;margin-top:14px;">If this wasn't you, contact your administrator immediately.</p>`),
  });
}

export const emailService = {
  passwordResetOtpEmail: async (email: string, name: string, otp: string, expiresInMinutes: number) => {
    await passwordResetOtpEmail(email, name, otp, expiresInMinutes);
  },
  passwordResetConfirmedEmail: async (email: string, name: string) => {
    await passwordResetConfirmedEmail(email, name);
  },
};

export { getTransporter };
