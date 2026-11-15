import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand, CreateBucketCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

/**
 * Tositetiedostojen tallennus. Oletus MinIO (S3). VOUCHER_STORAGE=local tallentaa levylle
 * kansioon VOUCHER_FILES_DIR (oletus apps/voucher-service/files), jolloin MinIOta ei tarvita
 * (yhden prosessin palvelin). Tositteen rivillä s3Bucket = "local" kertoo, mistä tiedosto haetaan,
 * joten vanhat MinIO-tositteet toimivat edelleen tilaa vaihdettaessa.
 */
export const LOCAL_BUCKET = "local";
const localStorage = () => process.env.VOUCHER_STORAGE === "local";
export const localFilesDir = () =>
  path.resolve(process.env.VOUCHER_FILES_DIR || path.join(__dirname, "..", "..", "files"));
const localPath = (key: string) => {
  const root = localFilesDir();
  const file = path.resolve(root, key);
  if (!file.startsWith(root + path.sep)) throw new Error("Virheellinen tiedostoavain");
  return file;
};

const s3Client = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT || "http://localhost:9000",
  region: "us-east-1", // Minio dummy region
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY || "admin",
    secretAccessKey: process.env.MINIO_SECRET_KEY || "password",
  },
  forcePathStyle: true, // Required for Minio
});

const s3Bucket = process.env.MINIO_BUCKET || "vouchers";
/** Bucket, johon uudet tositteet menevät (tallennetaan tositteen riville). */
export const currentBucket = () => (localStorage() ? LOCAL_BUCKET : s3Bucket);

let bucketReady: Promise<void> | null = null;

/** Luo bucketin, jos sitä ei ole (uusi MinIO-volyymi on tyhjä). */
const ensureBucket = () => {
  bucketReady ??= (async () => {
    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: s3Bucket }));
    } catch {
      await s3Client.send(new CreateBucketCommand({ Bucket: s3Bucket }));
      console.log(`Luotiin MinIO-bucket ${s3Bucket}`);
    }
  })().catch((err) => {
    bucketReady = null; // yritetään uudelleen seuraavalla kerralla
    throw err;
  });
  return bucketReady;
};

export const uploadToS3 = async (file: { originalname: string; buffer: Buffer; mimetype: string }): Promise<string> => {
  // Tiedostonimen erikoismerkit pois avaimesta (ääkköset ja välilyönnit hankaloittavat URL-polkuja)
  const safeName = file.originalname.replace(/[^\w.-]+/g, '_');
  const fileKey = `vouchers/${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;
  if (localStorage()) {
    const target = localPath(fileKey);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, file.buffer, { flag: "wx" }); // ei koskaan ylikirjoiteta
    return fileKey;
  }
  await ensureBucket();

  const command = new PutObjectCommand({
    Bucket: s3Bucket,
    Key: fileKey,
    Body: file.buffer,
    ContentType: file.mimetype,
  });

  await s3Client.send(command);
  return fileKey;
};

export const downloadFromS3 = async (bucket: string, key: string): Promise<Buffer> => {
  if (bucket === LOCAL_BUCKET) return fs.promises.readFile(localPath(key));
  const result = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await result.Body!.transformToByteArray());
};
