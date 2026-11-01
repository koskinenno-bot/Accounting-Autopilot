import { Kafka, Producer } from 'kafkajs';
import { VoucherUploadedEvent } from '@ai-accountant/types';

const brokers = process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['localhost:9092'];

const kafka = new Kafka({
  clientId: 'voucher-service',
  brokers: brokers
});

export const producer: Producer = kafka.producer();

export const connectProducer = async () => {
  try {
    await producer.connect();
    console.log('Kafka producer connected successfully in voucher-service');
  } catch (error) {
    console.error('Failed to connect Kafka producer:', error);
  }
};

export const publishVoucherUploaded = async (event: VoucherUploadedEvent) => {
  try {
    await producer.send({
      topic: 'voucher.uploaded',
      messages: [
        {
          key: event.data.voucherId,
          value: JSON.stringify(event)
        }
      ]
    });
    console.log(`Published voucher.uploaded event for voucher: ${event.data.voucherId}`);
  } catch (error) {
    console.error('Failed to publish voucher.uploaded event:', error);
  }
};
