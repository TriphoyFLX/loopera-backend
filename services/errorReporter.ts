/**
 * Optional Sentry reporting without bundling the full SDK.
 * Set SENTRY_DSN=https://<key>@oXXXX.ingest.sentry.io/YYYY
 */

type ReportPayload = {
  message: string;
  level?: 'error' | 'warning' | 'info';
  stack?: string;
  extra?: Record<string, unknown>;
};

function parseDsn(dsn: string): { url: string; publicKey: string; projectId: string } | null {
  try {
    const u = new URL(dsn);
    const publicKey = u.username;
    const projectId = u.pathname.replace(/^\//, '');
    if (!publicKey || !projectId) return null;
    const url = `${u.protocol}//${u.host}/api/${projectId}/store/`;
    return { url, publicKey, projectId };
  } catch {
    return null;
  }
}

export async function reportError(payload: ReportPayload): Promise<void> {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;

  const parsed = parseDsn(dsn);
  if (!parsed) return;

  const body = {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: new Date().toISOString(),
    platform: 'node',
    level: payload.level || 'error',
    server_name: process.env.DOMAIN || 'loopera',
    environment: process.env.NODE_ENV || 'production',
    message: payload.message,
    exception: payload.stack
      ? {
          values: [
            {
              type: 'Error',
              value: payload.message,
              stacktrace: {
                frames: payload.stack
                  .split('\n')
                  .slice(0, 40)
                  .map((line) => ({ filename: line.trim() })),
              },
            },
          ],
        }
      : undefined,
    extra: payload.extra,
  };

  try {
    await fetch(parsed.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=loopera/1.0`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    /* never crash on reporter failure */
  }
}

export function installProcessErrorHandlers(): void {
  process.on('uncaughtException', (err) => {
    console.error('uncaughtException', err);
    void reportError({
      message: err.message,
      stack: err.stack,
      extra: { kind: 'uncaughtException' },
    }).finally(() => {
      process.exit(1);
    });
  });

  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    console.error('unhandledRejection', reason);
    void reportError({ message, stack, extra: { kind: 'unhandledRejection' } });
  });
}
