import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

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

export const uploadToS3 = async (file: Express.Multer.File): Promise<string> => {
  const fileKey = `vouchers/${Date.now()}-${file.originalname}`;
  
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileKey,
    Body: file.buffer,
    ContentType: file.mimetype,
  });

  await s3Client.send(command);
  return fileKey;
};
