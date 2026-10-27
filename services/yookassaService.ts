import { randomUUID } from 'crypto';

const API_URL = 'https://api.yookassa.ru/v3';

function getCredentials() {
  const shopId = process.env.YOOKASSA_SHOP_ID || '';
  const secretKey = process.env.YOOKASSA_SECRET_KEY || '';
  return { shopId, secretKey };
}

export function isYookassaConfigured(): boolean {
  const { shopId, secretKey } = getCredentials();
  if (!shopId || !secretKey) return false;
  if (secretKey.includes('your_') || secretKey.includes('change_this')) return false;
  return true;
}

function authHeader(): string {
  const { shopId, secretKey } = getCredentials();
  return 'Basic ' + Buffer.from(`${shopId}:${secretKey}`).toString('base64');
}

export interface CreatePaymentParams {
  amountRub: number;
  description: string;
  returnUrl: string;
  metadata: Record<string, string>;
}

export interface YooKassaPayment {
  id: string;
  status: string;
  amount?: { value: string; currency: string };
  confirmation?: { type: string; confirmation_url?: string };
  metadata?: Record<string, string>;
}

export async function createPayment(params: CreatePaymentParams): Promise<YooKassaPayment> {
  const idempotenceKey = randomUUID();
  const value = Number(params.amountRub).toFixed(2);

  const response = await fetch(`${API_URL}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotence-Key': idempotenceKey,
      Authorization: authHeader(),
    },
    body: JSON.stringify({
      amount: { value, currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: params.returnUrl },
      description: params.description.slice(0, 128),
      metadata: params.metadata,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`YooKassa create payment failed (${response.status}): ${body}`);
  }

  return response.json() as Promise<YooKassaPayment>;
}

export async function getPayment(paymentId: string): Promise<YooKassaPayment> {
  const response = await fetch(`${API_URL}/payments/${paymentId}`, {
    headers: { Authorization: authHeader() },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`YooKassa get payment failed (${response.status}): ${body}`);
  }

  return response.json() as Promise<YooKassaPayment>;
}
