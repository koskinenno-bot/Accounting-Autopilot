import { Kafka, Producer } from 'kafkajs';
import { BankStatementReceivedEvent } from '@ai-accountant/types';
import { localBusEnabled, publishLocal } from './localBus';

const brokers = process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['localhost:9092'];

const kafka = new Kafka({
  clientId: 'bank-service',
  brokers: brokers
});

export const producer: Producer = kafka.producer();

export const connectProducer = async () => {
  if (localBusEnabled()) return;
  try {
    await producer.connect();
    console.log('Kafka producer connected successfully in bank-service');
  } catch (error) {
    console.error('Failed to connect Kafka producer:', error);
  }
};

/** Palauttaa false, jos julkaisu epäonnistui (pankkiyhteyden synkronointi ei silloin siirrä hakukohtaa eteenpäin). */
export const publishBankStatementReceived = async (event: BankStatementReceivedEvent): Promise<boolean> => {
  try {
    if (localBusEnabled()) {
      await publishLocal('bank.statement.received', event);
      return true;
    }
    await producer.send({
      topic: 'bank.statement.received',
      messages: [
        {
          key: event.data.companyId,
          value: JSON.stringify(event)
        }
      ]
    });
    console.log(`Published bank.statement.received event for company: ${event.data.companyId}`);
    return true;
  } catch (error) {
    console.error('Failed to publish bank statement event:', error);
    return false;
  }
};

export const disconnectProducer = async () => {
  if (localBusEnabled()) return;
  await producer.disconnect();
};
