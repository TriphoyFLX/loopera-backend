import { createReadStream, existsSync, promises as fs } from 'fs';
import path from 'path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * S3-compatible object storage (AWS S3, Cloudflare R2, MinIO).
 * When S3_BUCKET is unset, files stay on local disk under /uploads.
 *
 * Env:
 *   S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
 *   S3_ENDPOINT (optional — R2/MinIO)
 *   S3_FORCE_PATH_STYLE=true (MinIO)
 *   MEDIA_CDN_URL (optional public base, e.g. https://cdn.loopera.ru)
 */

let client: S3Client | null = null;

function getClient(): S3Client | null {
  if (!process.env.S3_BUCKET) return null;
  if (client) return client;

  const endpoint = process.env.S3_ENDPOINT?.trim() || undefined;
  client = new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true' || Boolean(endpoint),
    credentials:
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          }
        : undefined,
  });
  return client;
}

export function isObjectStorageEnabled(): boolean {
  return Boolean(process.env.S3_BUCKET);
}

export function getMediaCdnBase(): string {
  return (process.env.MEDIA_CDN_URL || '').replace(/\/$/, '');
}

/** Convert `/uploads/shop/x.zip` → `shop/x.zip` object key */
export function uploadPathToKey(uploadUrl: string): string {
  const cleaned = uploadUrl.replace(/^https?:\/\/[^/]+/, '').replace(/^\/+/, '');
  return cleaned.replace(/^uploads\//, '');
}

/** Public URL for browsers (CDN if set, else same-origin /uploads/...) */
export function publicMediaUrl(uploadUrlOrKey: string): string {
  if (!uploadUrlOrKey) return '';
  if (/^https?:\/\//i.test(uploadUrlOrKey)) return uploadUrlOrKey;

  const key = uploadPathToKey(uploadUrlOrKey);
  const cdn = getMediaCdnBase();
  if (cdn && isObjectStorageEnabled()) {
    return `${cdn}/${key}`;
  }
  return uploadUrlOrKey.startsWith('/') ? uploadUrlOrKey : `/uploads/${key}`;
}

export async function putLocalFile(
  localPath: string,
  key: string,
  contentType?: string,
): Promise<{ key: string; publicUrl: string }> {
  const s3 = getClient();
  const bucket = process.env.S3_BUCKET!;
  if (!s3) {
    return { key, publicUrl: `/uploads/${key}` };
  }

  const body = createReadStream(localPath);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );

  return { key, publicUrl: publicMediaUrl(key) };
}

type UploadedDiskFile = {
  path: string;
  filename: string;
  mimetype?: string;
};

/** After multer disk save: dual-write to S3 when configured. Returns URL to store in DB. */
export async function persistMulterFile(
  file: UploadedDiskFile,
  folder: 'shop' | 'loops' | 'loops/covers' | 'avatars' | 'looptok' | 'beats',
): Promise<string> {
  const key = `${folder}/${file.filename}`;
  const localUrl = `/uploads/${key}`;

  if (!isObjectStorageEnabled()) {
    return localUrl;
  }

  try {
    await putLocalFile(file.path, key, file.mimetype);
    // Keep local copy as cache/fallback unless STORAGE_DELETE_LOCAL=true
    if (process.env.STORAGE_DELETE_LOCAL === 'true') {
      await fs.unlink(file.path).catch(() => undefined);
    }
    return publicMediaUrl(key);
  } catch (err) {
    console.error('S3 upload failed, keeping local path:', err);
    return localUrl;
  }
}

export async function objectExists(key: string): Promise<boolean> {
  const s3 = getClient();
  if (!s3 || !process.env.S3_BUCKET) return false;
  try {
    await s3.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** Short-lived signed GET for private archives (default 10 min). */
export async function getSignedDownloadUrl(
  uploadUrlOrKey: string,
  expiresInSeconds = 600,
  filename?: string,
): Promise<string | null> {
  const s3 = getClient();
  const bucket = process.env.S3_BUCKET;
  if (!s3 || !bucket) return null;

  const key = uploadPathToKey(uploadUrlOrKey);
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentDisposition: filename
      ? `attachment; filename="${filename.replace(/"/g, '')}"`
      : undefined,
  });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

export function localPathFromUploadUrl(uploadUrl: string): string {
  const relative = uploadUrl.replace(/^\/uploads\//, 'uploads/').replace(/^uploads\//, 'uploads/');
  if (relative.startsWith('uploads/')) {
    return path.join(process.cwd(), relative);
  }
  return path.join(process.cwd(), 'uploads', uploadPathToKey(uploadUrl));
}

export function localFileExists(uploadUrl: string): boolean {
  try {
    return existsSync(localPathFromUploadUrl(uploadUrl));
  } catch {
    return false;
  }
}
