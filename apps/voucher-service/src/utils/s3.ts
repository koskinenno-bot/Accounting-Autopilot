import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand, CreateBucketCommand } from "@aws-sdk/client-s3";

const s3Client = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT || "http://localhost:9000",
  region: "us-east-1", // Minio dummy region
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY || "admin",
    secretAccessKey: process.env.MINIO_SECRET_KEY || "password",
  },
  forcePathStyle: true, // Required for Minio
});

export const bucketName = process.env.MINIO_BUCKET || "vouchers";

let bucketReady: Promise<void> | null = null;

/** Luo bucketin, jos sitä ei ole (uusi MinIO-volyymi on tyhjä). */
const ensureBucket = () => {
  bucketReady ??= (async () => {
    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
    } catch {
      await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
      console.log(`Luotiin MinIO-bucket ${bucketName}`);
    }
  })().catch((err) => {
    bucketReady = null; // yritetään uudelleen seuraavalla kerralla
    throw err;
  });
  return bucketReady;
};

export const uploadToS3 = async (file: { originalname: string; buffer: Buffer; mimetype: string }): Promise<string> => {
  await ensureBucket();
  // Tiedostonimen erikoismerkit pois avaimesta (ääkköset ja välilyönnit hankaloittavat URL-polkuja)
  const safeName = file.originalname.replace(/[^\w.-]+/g, '_');
  const fileKey = `vouchers/${Date.now()}-${safeName}`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileKey,
    Body: file.buffer,
    ContentType: file.mimetype,
  });

  await s3Client.send(command);
  return fileKey;
};

export const downloadFromS3 = async (bucket: string, key: string): Promise<Buffer> => {
  const result = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await result.Body!.transformToByteArray());
};
