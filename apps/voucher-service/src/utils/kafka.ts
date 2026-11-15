import { Kafka, Producer } from 'kafkajs';
import { VoucherClassifiedEvent, VoucherUploadedEvent } from '@ai-accountant/types';
import { localBusEnabled, publishLocal } from './localBus';

const brokers = process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['localhost:9092'];

const kafka = new Kafka({
  clientId: 'voucher-service',
  brokers: brokers
});

export const producer: Producer = kafka.producer();

export const connectProducer = async () => {
  if (localBusEnabled()) return;
  try {
    await producer.connect();
    console.log('Kafka producer connected successfully in voucher-service');
  } catch (error) {
    console.error('Failed to connect Kafka producer:', error);
  }
};

/** Luetun tositteen tiedot accounting-servicelle (kirjausluonnos). Virhe heitetään kutsujalle. */
export const publishVoucherClassified = async (event: VoucherClassifiedEvent) => {
  if (localBusEnabled()) {
    await publishLocal('voucher.classified', event);
    console.log(`Published voucher.classified for voucher: ${event.data.voucherId}`);
    return;
  }
  await producer.send({
    topic: 'voucher.classified',
    messages: [{ key: event.data.voucherId, value: JSON.stringify(event) }],
  });
  console.log(`Published voucher.classified for voucher: ${event.data.voucherId}`);
};

export const publishVoucherUploaded = async (event: VoucherUploadedEvent) => {
  if (localBusEnabled()) return; // ei tilaajia
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
