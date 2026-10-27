import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { publicMediaUrl, uploadPathToKey } from '../services/objectStorage.ts';

describe('objectStorage URL helpers', () => {
  it('strips /uploads prefix into object key', () => {
    assert.equal(uploadPathToKey('/uploads/shop/a.zip'), 'shop/a.zip');
    assert.equal(uploadPathToKey('uploads/loops/x.mp3'), 'loops/x.mp3');
  });

  it('keeps relative /uploads when CDN unset', () => {
    const prev = process.env.MEDIA_CDN_URL;
    const prevBucket = process.env.S3_BUCKET;
    delete process.env.MEDIA_CDN_URL;
    delete process.env.S3_BUCKET;
    assert.equal(publicMediaUrl('/uploads/shop/a.zip'), '/uploads/shop/a.zip');
    process.env.MEDIA_CDN_URL = prev;
    process.env.S3_BUCKET = prevBucket;
  });

  it('rewrites to CDN when storage + CDN configured', () => {
    const prevCdn = process.env.MEDIA_CDN_URL;
    const prevBucket = process.env.S3_BUCKET;
    process.env.MEDIA_CDN_URL = 'https://cdn.example.com';
    process.env.S3_BUCKET = 'loopera';
    assert.equal(publicMediaUrl('/uploads/shop/a.zip'), 'https://cdn.example.com/shop/a.zip');
    process.env.MEDIA_CDN_URL = prevCdn;
    process.env.S3_BUCKET = prevBucket;
  });
});
