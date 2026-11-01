import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { connectProducer, publishVoucherUploaded } from './utils/kafka';
import { uploadToS3, bucketName } from './utils/s3';
import { requireAuth } from './middleware/requireAuth';
import { createHash } from 'crypto';

const app = express();
const prisma = new PrismaClient();
const port = process.env.PORT || 3003;
const uploadDir = process.env.UPLOAD_DIR || './uploads';

// Ensure upload directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(cors());
app.use(express.json());

// Connect Kafka
connectProducer();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'voucher-service' });
});

// Voucher upload endpoint
app.post('/api/v1/vouchers/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const { companyId, voucherType, voucherDate } = req.body;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required' });
    }

    // 1. Upload to S3/MinIO
    const s3Key = await uploadToS3(file);

    // 2. Create Voucher record
    const voucher = await prisma.voucher.create({
      data: {
        companyId,
        voucherType: voucherType || 'PURCHASE',
        voucherDate: new Date(voucherDate || Date.now()),
        ocrStatus: 'PENDING',
        status: 'UNPROCESSED',
        uploadedBy: (req as any).user?.userId || 'system',
        files: {
          create: {
            filename: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            s3Key: s3Key,
            s3Bucket: bucketName,
            checksum: createHash('sha256').update(file.buffer).digest('hex'), // eheyden todentaminen (KPL 2:10 §)
          }
        }
      },
      include: { files: true }
    });

    // 3. Trigger Autmation Pipeline via Kafka
    await publishVoucherUploaded({
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      data: {
        voucherId: voucher.id,
        companyId: companyId,
        s3Key: s3Key,
        s3Bucket: bucketName,
        filename: file.originalname,
        voucherType: voucher.voucherType
      }
    });

    res.json({ 
      message: 'Voucher uploaded and automation pipeline triggered', 
      voucherId: voucher.id,
      s3Key: s3Key 
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.listen(port, () => {
  console.log(`Voucher Service running on port ${port}`);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
