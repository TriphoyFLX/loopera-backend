import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

function env(name: string, fallback = ''): string {
  return String(process.env[name] || fallback).trim();
}

const RESEND_API_KEY = env('RESEND_API_KEY');
const SMTP_HOST = env('SMTP_HOST', 'smtp.gmail.com');
const SMTP_PORT = Number(env('SMTP_PORT', '465')) || 465;
const SMTP_SECURE = env('SMTP_SECURE', String(SMTP_PORT === 465)) !== 'false';
const SMTP_USER = env('SMTP_USER', env('EMAIL_USER'));
const SMTP_PASS = env('SMTP_PASS', env('EMAIL_PASS'));
const EMAIL_FROM = env('EMAIL_FROM', 'noreply@loopera.ru');
const EMAIL_FROM_NAME = env('EMAIL_FROM_NAME', 'Loopera');
const SUPPORT_EMAIL = env('SUPPORT_EMAIL', 'support@loopera.ru');

/** Ops inbox — registrations, types, money. Comma-separated OK. */
function getOpsEmails(): string[] {
  return env('OPS_EMAIL', env('ADMIN_NOTIFY_EMAIL', 'triphoyloops@gmail.com'))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Partnership / collaboration inbox */
function getPartnersEmails(): string[] {
  return env('PARTNERS_EMAIL', 'triphoyloops@gmail.com')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const useResend = Boolean(RESEND_API_KEY);

let transporter: nodemailer.Transporter | null = null;
if (!useResend) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
  transporter.verify((error) => {
    if (error) {
      console.error('Email transporter error:', error);
    } else {
      console.log(`Email SMTP ready (${SMTP_HOST}:${SMTP_PORT} as ${EMAIL_FROM})`);
    }
  });
} else {
  console.log(`Email via Resend ready (from ${EMAIL_FROM})`);
}

export const generateVerificationCode = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

function wrapHtml(title: string, body: string): string {
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;">
    <div style="margin-bottom:20px;">
      <div style="font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:#888;">Loopera</div>
      <h1 style="margin:8px 0 0;font-size:22px;font-weight:600;letter-spacing:-0.02em;">${title}</h1>
    </div>
    <div style="background:#f5f5f7;border-radius:14px;padding:20px;line-height:1.5;font-size:15px;color:#333;">
      ${body}
    </div>
    <p style="margin-top:18px;font-size:12px;color:#999;">Это автоматическое письмо с loopera.ru</p>
  </div>`;
}

function fromHeader(): string {
  return `${EMAIL_FROM_NAME} <${EMAIL_FROM}>`;
}

async function sendViaResend(options: {
  to: string[];
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromHeader(),
      to: options.to,
      subject: options.subject,
      html: options.html,
      reply_to: options.replyTo || SUPPORT_EMAIL,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Resend API ${response.status}: ${text}`);
  }
}

async function sendViaSmtp(options: {
  to: string[];
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<void> {
  if (!transporter) throw new Error('SMTP transporter not configured');
  if (!SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP credentials missing (SMTP_USER/SMTP_PASS or EMAIL_USER/EMAIL_PASS)');
  }
  await transporter.sendMail({
    from: fromHeader(),
    to: options.to.join(', '),
    subject: options.subject,
    html: options.html,
    replyTo: options.replyTo || SUPPORT_EMAIL,
  });
}

async function sendMail(options: {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<void> {
  const toList = (Array.isArray(options.to) ? options.to : [options.to])
    .map((s) => s.trim())
    .filter(Boolean);
  if (!toList.length) throw new Error('No recipients');

  if (useResend) {
    await sendViaResend({ ...options, to: toList });
    return;
  }
  await sendViaSmtp({ ...options, to: toList });
}

/** Never throws — used for ops alerts so money flows aren't blocked. */
async function safeSend(options: {
  to: string[];
  subject: string;
  html: string;
}): Promise<void> {
  try {
    if (!options.to.length) return;
    await sendMail(options);
  } catch (error) {
    console.error('Email send failed:', options.subject, error);
  }
}

export const sendVerificationCode = async (email: string, code: string): Promise<void> => {
  try {
    await sendMail({
      to: email,
      subject: 'Код подтверждения Loopera',
      html: wrapHtml(
        'Код подтверждения',
        `<p style="margin:0 0 12px;">Ваш код:</p>
         <div style="font-size:32px;font-weight:700;letter-spacing:0.2em;color:#111;">${code}</div>
         <p style="margin:16px 0 0;color:#666;font-size:14px;">Действует 10 минут. Если вы не регистрировались — просто проигнорируйте письмо.</p>`,
      ),
    });
    console.log('Verification code sent to:', email);
  } catch (error) {
    console.error('Error sending verification code:', error);
    console.log('=== VERIFICATION CODE FALLBACK ===');
    console.log('Email:', email);
    console.log('Code:', code);
    console.log('==================================');

    if (process.env.NODE_ENV === 'development') return;
    throw new Error('Failed to send verification code');
  }
};

export const sendPasswordResetCode = async (email: string, code: string): Promise<void> => {
  try {
    await sendMail({
      to: email,
      subject: 'Сброс пароля Loopera',
      html: wrapHtml(
        'Сброс пароля',
        `<p style="margin:0 0 12px;">Код для сброса пароля:</p>
         <div style="font-size:32px;font-weight:700;letter-spacing:0.2em;color:#111;">${code}</div>
         <p style="margin:16px 0 0;color:#666;font-size:14px;">Действует 15 минут.</p>`,
      ),
    });
  } catch (error) {
    console.error('Error sending reset code:', error);
    if (process.env.NODE_ENV === 'development') return;
    throw new Error('Failed to send password reset code');
  }
};

export async function notifyNewRegistration(user: {
  id: number;
  username: string;
  email: string;
}): Promise<void> {
  await safeSend({
    to: getOpsEmails(),
    subject: `[Loopera] Новая регистрация · ${user.username}`,
    html: wrapHtml(
      'Новая регистрация',
      `<p><b>ID:</b> ${user.id}</p>
       <p><b>Username:</b> ${user.username}</p>
       <p><b>Email:</b> ${user.email}</p>`,
    ),
  });
}

export async function notifyArtistTypesSelected(user: {
  id: number;
  username?: string;
  email?: string;
  artists: string[];
}): Promise<void> {
  await safeSend({
    to: getOpsEmails(),
    subject: `[Loopera] Выбор тайпов · ${user.username || user.id}`,
    html: wrapHtml(
      'Пользователь выбрал тайпы',
      `<p><b>ID:</b> ${user.id}</p>
       <p><b>Username:</b> ${user.username || '—'}</p>
       <p><b>Email:</b> ${user.email || '—'}</p>
       <p><b>Тайпы (${user.artists.length}):</b> ${user.artists.map((a) => `#${a}`).join(', ')}</p>`,
    ),
  });
}

export async function notifyPackSale(details: {
  orderId?: number;
  paymentId: string;
  price: number;
  commission?: number;
  sellerEarnings?: number;
  packTitle?: string;
  buyerId?: number;
  sellerId?: number;
  already?: boolean;
}): Promise<void> {
  if (details.already) return;
  await safeSend({
    to: getOpsEmails(),
    subject: `[Loopera] Продажа пака · ${details.price} ₽`,
    html: wrapHtml(
      'Продажа пака',
      `<p><b>Пак:</b> ${details.packTitle || '—'}</p>
       <p><b>Сумма:</b> ${details.price} ₽</p>
       <p><b>Комиссия:</b> ${details.commission ?? '—'} ₽</p>
       <p><b>Продавцу:</b> ${details.sellerEarnings ?? '—'} ₽</p>
       <p><b>Buyer ID:</b> ${details.buyerId ?? '—'}</p>
       <p><b>Seller ID:</b> ${details.sellerId ?? '—'}</p>
       <p><b>Payment:</b> ${details.paymentId}</p>`,
    ),
  });
}

export async function notifySubscriptionPaid(details: {
  userId: number;
  username?: string;
  plan: string;
  period: string;
  amount?: number;
  paymentId: string;
  already?: boolean;
}): Promise<void> {
  if (details.already) return;
  await safeSend({
    to: getOpsEmails(),
    subject: `[Loopera] Подписка ${details.plan.toUpperCase()} · user ${details.userId}`,
    html: wrapHtml(
      'Оплата подписки',
      `<p><b>User ID:</b> ${details.userId}</p>
       <p><b>Username:</b> ${details.username || '—'}</p>
       <p><b>План:</b> ${details.plan}</p>
       <p><b>Период:</b> ${details.period}</p>
       <p><b>Сумма:</b> ${details.amount != null ? `${details.amount} ₽` : '—'}</p>
       <p><b>Payment:</b> ${details.paymentId}</p>`,
    ),
  });
}

export async function notifyWithdrawalRequest(details: {
  id: number;
  userId: number;
  username?: string;
  amount: number;
  phone: string;
  bank: string;
  method: string;
}): Promise<void> {
  await safeSend({
    to: getOpsEmails(),
    subject: `[Loopera] Заявка на вывод · ${details.amount} ₽`,
    html: wrapHtml(
      'Заявка на вывод',
      `<p><b>Заявка #:</b> ${details.id}</p>
       <p><b>User ID:</b> ${details.userId} (${details.username || '—'})</p>
       <p><b>Сумма:</b> ${details.amount} ₽</p>
       <p><b>Метод:</b> ${details.method}</p>
       <p><b>Телефон:</b> ${details.phone}</p>
       <p><b>Банк:</b> ${details.bank}</p>`,
    ),
  });
}

export async function notifyPartnership(subject: string, bodyHtml: string): Promise<void> {
  await safeSend({
    to: getPartnersEmails(),
    subject: `[Loopera · партнёрство] ${subject}`,
    html: wrapHtml('Заявка на сотрудничество', bodyHtml),
  });
}

export const mailConfigSummary = () => ({
  provider: useResend ? 'resend' : 'smtp',
  from: EMAIL_FROM,
  ops: getOpsEmails(),
  partners: getPartnersEmails(),
  configured: useResend || Boolean(SMTP_USER && SMTP_PASS),
});
