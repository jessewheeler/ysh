const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');
const crypto = require('crypto');

const REQUIRED_VARS = ['B2_ENDPOINT', 'B2_REGION', 'B2_BUCKET', 'B2_KEY_ID', 'B2_APP_KEY', 'B2_PUBLIC_URL'];

function isConfigured() {
  return REQUIRED_VARS.every((v) => process.env[v]);
}

function getClient() {
  return new S3Client({
    endpoint: process.env.B2_ENDPOINT,
    region: process.env.B2_REGION,
    credentials: {
      accessKeyId: process.env.B2_KEY_ID,
      secretAccessKey: process.env.B2_APP_KEY,
    },
  });
}

async function uploadFile(buffer, originalName, folder) {
  const ext = path.extname(originalName);
  const unique = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  const key = `${folder}/${unique}`;

  const client = getClient();
  await client.send(new PutObjectCommand({
    Bucket: process.env.B2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimeFromExt(ext),
  }));

  return `${process.env.B2_PUBLIC_URL}/${key}`;
}

async function deleteFile(fileUrl) {
  if (!fileUrl || !isConfigured()) return;

  const publicUrl = process.env.B2_PUBLIC_URL;
  if (!fileUrl.startsWith(publicUrl)) return;

  const key = fileUrl.slice(publicUrl.length + 1); // strip leading /
  const client = getClient();
  await client.send(new DeleteObjectCommand({
    Bucket: process.env.B2_BUCKET,
    Key: key,
  }));
}

async function uploadFileAtKey(buffer, key, contentType) {
    const client = getClient();
    await client.send(new PutObjectCommand({
        Bucket: process.env.B2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
    }));
    return `${process.env.B2_PUBLIC_URL}/${key}`;
}

function mimeFromExt(ext) {
  const types = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
      '.pdf': 'application/pdf',
  };
  return types[ext.toLowerCase()] || 'application/octet-stream';
}

module.exports = {uploadFile, uploadFileAtKey, deleteFile, isConfigured};
