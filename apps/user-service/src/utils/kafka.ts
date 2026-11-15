import { Kafka } from 'kafkajs';
import { CompanyCreatedEvent } from '@ai-accountant/types';
import { localBusEnabled, publishLocal } from './localBus';

// TODO: Read brokers from env var, defaulting to local docker for now
const brokers = process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['localhost:9092'];

const kafka = new Kafka({
  clientId: 'user-service',
  brokers: brokers
});

export const producer = kafka.producer();

export const connectProducer = async () => {
  if (localBusEnabled()) return;
  try {
    await producer.connect();
    console.log('Kafka producer connected successfully in user-service');
  } catch (error) {
    console.error('Failed to connect Kafka producer:', error);
  }
};

export const disconnectProducer = async () => {
  if (localBusEnabled()) return;
  await producer.disconnect();
};

export const publishCompanyCreated = async (event: CompanyCreatedEvent) => {
  try {
    if (localBusEnabled()) {
      await publishLocal('company.created', event);
      return;
    }
    await producer.send({
      topic: 'company.created',
      messages: [
        {
          key: event.data.companyId,
          value: JSON.stringify(event)
        }
      ]
    });
    console.log(`Published company.created event for company: ${event.data.companyId}`);
  } catch (error) {
    console.error('Failed to publish company.created event:', error);
    // In production, we should implement a retry mechanism or outbox pattern here
  }
};
