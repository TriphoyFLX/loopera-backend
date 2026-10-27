import type { Request, Response } from 'express';

function env(name: string, fallback = ''): string {
  return String(process.env[name] || fallback).trim();
}

const RESEND_API_KEY = env('RESEND_API_KEY');
const EMAIL_FROM = env('EMAIL_FROM', 'noreply@loopera.ru');
const EMAIL_FROM_NAME = env('EMAIL_FROM_NAME', 'Loopera');
const FORWARD_TO = env(
  'INBOUND_FORWARD_TO',
  env('OPS_EMAIL', 'triphoyloops@gmail.com'),
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

async function resendFetch(path: string, init?: RequestInit) {
  const response = await fetch(`https://api.resend.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`Resend ${path} ${response.status}: ${text}`);
  }
  return json;
}

/**
 * Resend inbound webhook: email.received → forward to Gmail.
 * Docs: https://resend.com/docs/dashboard/receiving/introduction
 */
export const handleResendWebhook = async (req: Request, res: Response) => {
  try {
    if (!RESEND_API_KEY) {
      return res.status(500).json({ error: 'RESEND_API_KEY missing' });
    }
    if (!FORWARD_TO.length) {
      return res.status(500).json({ error: 'INBOUND_FORWARD_TO / OPS_EMAIL missing' });
    }

    const event = req.body;
    if (!event || event.type !== 'email.received') {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const emailId = event?.data?.email_id as string | undefined;
    if (!emailId) {
      return res.status(400).json({ error: 'email_id missing' });
    }

    const meta = event.data || {};
    const toList: string[] = Array.isArray(meta.to) ? meta.to : [];
    const from = String(meta.from || 'unknown');
    const subject = String(meta.subject || '(без темы)');

    // Full body requires receiving API (needs non-send-only key)
    let html = '';
    let text = '';
    try {
      const received = await resendFetch(`/emails/receiving/${emailId}`);
      html = String(received?.html || received?.data?.html || '');
      text = String(received?.text || received?.data?.text || '');
    } catch (err) {
      console.error('Resend receiving get failed (need full API key?):', err);
      html = `<p>Не удалось загрузить тело письма из Resend Receiving API.</p>
        <p>Создай API key без ограничения «Sending access only» и положи в RESEND_API_KEY.</p>`;
    }

    const forwardSubject = `[Loopera] ${toList.join(', ') || 'inbox'}: ${subject}`;
    const forwardHtml = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:640px;margin:0 auto;">
        <p style="color:#666;font-size:13px;">
          Входящее на <b>${toList.join(', ') || 'loopera.ru'}</b><br/>
          От: <b>${from}</b><br/>
          Тема: <b>${subject}</b>
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0;" />
        ${html || (text ? `<pre style="white-space:pre-wrap;">${text}</pre>` : '<p>(пустое тело)</p>')}
      </div>`;

    await resendFetch('/emails', {
      method: 'POST',
      body: JSON.stringify({
        from: `${EMAIL_FROM_NAME} Inbox <${EMAIL_FROM}>`,
        to: FORWARD_TO,
        subject: forwardSubject,
        html: forwardHtml,
        reply_to: from.includes('@') ? from : undefined,
      }),
    });

    console.log('Inbound forwarded', { emailId, toList, forwardTo: FORWARD_TO });
    return res.status(200).json({ ok: true, forwarded: true });
  } catch (error) {
    console.error('Resend webhook error:', error);
    return res.status(500).json({ error: 'webhook failed' });
  }
};
