import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type StorageDriver = "LOCAL" | "S3";

function toDriver(value: string | undefined): StorageDriver {
  return (value || "LOCAL").trim().toUpperCase() === "S3" ? "S3" : "LOCAL";
}

function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function cleanKey(value: string) {
  return value.replace(/^\/+/, "");
}

const driver = toDriver(process.env.STORAGE_DRIVER);

function storageConfig() {
  return {
    driver,
    region: process.env.S3_REGION || "",
    bucket: process.env.S3_BUCKET || "",
    endpoint: process.env.S3_ENDPOINT || "",
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL || "",
    forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || "").trim().toLowerCase() === "true",
  };
}

let s3Client: S3Client | null = null;

function getS3Client() {
  if (s3Client) return s3Client;
  const cfg = storageConfig();
  if (!cfg.region || !cfg.bucket) {
    throw new Error("S3_REGION and S3_BUCKET are required when STORAGE_DRIVER=S3");
  }
  s3Client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint || undefined,
    forcePathStyle: cfg.forcePathStyle,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return s3Client;
}

function s3DefaultPublicUrl(key: string, bucket: string, region: string) {
  return `https://${bucket}.s3.${region}.amazonaws.com/${cleanKey(key)}`;
}

export function getStorageDriver() {
  return storageConfig().driver;
}

export function isS3StorageEnabled() {
  return getStorageDriver() === "S3";
}

export function publicUrlFromKey(key: string | null | undefined) {
  if (!key) return null;
  const cfg = storageConfig();
  if (cfg.driver !== "S3") {
    return `/uploads/${cleanKey(key)}`;
  }
  if (cfg.publicBaseUrl) {
    return `${trimSlash(cfg.publicBaseUrl)}/${cleanKey(key)}`;
  }
  if (!cfg.bucket || !cfg.region) return null;
  return s3DefaultPublicUrl(key, cfg.bucket, cfg.region);
}

export async function uploadBufferToStorage(input: {
  key: string;
  body: Buffer;
  contentType: string;
}) {
  const cfg = storageConfig();
  if (cfg.driver !== "S3") {
    throw new Error("uploadBufferToStorage can only be used when STORAGE_DRIVER=S3");
  }
  if (!cfg.bucket) throw new Error("S3_BUCKET is required when STORAGE_DRIVER=S3");

  const client = getS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: cleanKey(input.key),
      Body: input.body,
      ContentType: input.contentType,
    })
  );
}

export async function createPresignedPutUrl(input: {
  key: string;
  contentType: string;
  expiresInSec?: number;
}) {
  const cfg = storageConfig();
  if (cfg.driver !== "S3") {
    throw new Error("Presigned upload is available only when STORAGE_DRIVER=S3");
  }
  if (!cfg.bucket) throw new Error("S3_BUCKET is required when STORAGE_DRIVER=S3");

  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: cleanKey(input.key),
    ContentType: input.contentType,
  });

  const expiresIn = Math.max(60, Math.min(input.expiresInSec ?? 300, 3600));
  const uploadUrl = await getSignedUrl(client, command, { expiresIn });
  return { uploadUrl, expiresIn };
}

export async function createPresignedGetUrlFromKey(input: {
  key: string;
  expiresInSec?: number;
}) {
  const cfg = storageConfig();
  if (cfg.driver !== "S3") {
    return publicUrlFromKey(input.key);
  }
  if (!cfg.bucket) throw new Error("S3_BUCKET is required when STORAGE_DRIVER=S3");

  const client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: cfg.bucket,
    Key: cleanKey(input.key),
  });
  const expiresIn = Math.max(60, Math.min(input.expiresInSec ?? 900, 3600));
  return getSignedUrl(client, command, { expiresIn });
}

export async function storageObjectExists(key: string) {
  const cfg = storageConfig();
  if (cfg.driver !== "S3") return false;
  if (!cfg.bucket) throw new Error("S3_BUCKET is required when STORAGE_DRIVER=S3");

  const client = getS3Client();
  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: cfg.bucket,
        Key: cleanKey(key),
      })
    );
    return true;
  } catch {
    return false;
  }
}
