#!/usr/bin/env node
/**
 * One-shot: walk ./uploads and put each file into S3/R2.
 * Usage (from backend-repo, with .env.production loaded):
 *   node --env-file=.env.production scripts/sync-uploads-to-s3.mjs
 */
import { createReadStream, existsSync, promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const uploadsRoot = path.join(root, 'uploads');

const bucket = process.env.S3_BUCKET;
if (!bucket) {
  console.error('S3_BUCKET is required');
  process.exit(1);
}

const client = new S3Client({
  region: process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT || undefined,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true' || Boolean(process.env.S3_ENDPOINT),
  credentials:
    process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        }
      : undefined,
});

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile()) yield full;
  }
}

async function existsOnS3(key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

function guessType(file) {
  const ext = path.extname(file).toLowerCase();
  const map = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.zip': 'application/zip',
    '.json': 'application/json',
  };
  return map[ext] || 'application/octet-stream';
}

async function main() {
  if (!existsSync(uploadsRoot)) {
    console.error('No uploads/ directory at', uploadsRoot);
    process.exit(1);
  }

  let uploaded = 0;
  let skipped = 0;
  for await (const file of walk(uploadsRoot)) {
    const key = path.relative(uploadsRoot, file).split(path.sep).join('/');
    if (await existsOnS3(key)) {
      skipped += 1;
      continue;
    }
    const Body = createReadStream(file);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body,
        ContentType: guessType(file),
      }),
    );
    uploaded += 1;
    console.log('put', key);
  }
  console.log(`done uploaded=${uploaded} skipped=${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
