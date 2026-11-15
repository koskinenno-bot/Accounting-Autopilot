import { Kafka, Producer, Consumer } from 'kafkajs';
import { InvoiceCreatedEvent, InvoiceStatusChangedEvent } from '@ai-accountant/types';
import { handleBankStatementReceived } from '../consumers/bankConsumer';
import { localBusEnabled, publishLocal, subscribeLocal } from './localBus';

const brokers = process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['localhost:9092'];

const kafka = new Kafka({
  clientId: 'invoicing-service',
  brokers: brokers
});

export const producer: Producer = kafka.producer();
export const consumer: Consumer = kafka.consumer({ groupId: 'invoicing-group' });

export const connectKafka = async () => {
  if (localBusEnabled()) {
    subscribeLocal('bank.statement.received', 'invoicing:bank.statement.received', (event) => handleBankStatementReceived(event));
    console.log('invoicing-service: paikallinen tapahtumaväylä käytössä');
    return;
  }
  try {
    await producer.connect();
    await consumer.connect();
    console.log('Kafka connected in invoicing-service');
    
    await consumer.subscribe({ topic: 'bank.statement.received', fromBeginning: true });
    
    await consumer.run({
      eachMessage: async ({ topic, message }) => {
        try {
          if (topic === 'bank.statement.received' && message.value) {
            const event = JSON.parse(message.value.toString());
            await handleBankStatementReceived(event);
          }
        } catch (err) {
          // Ilman try/catchia yksi virheellinen viesti kaataa kuluttajan ja jumittaa jonon.
          console.error(`Error processing message from topic ${topic}:`, err);
        }
      }
    });
  } catch (error) {
    console.error('Kafka connection error:', error);
  }
};

export const disconnectKafka = async () => {
  if (localBusEnabled()) return;
  await consumer.disconnect();
  await producer.disconnect();
};

export const publishInvoiceCreated = async (event: InvoiceCreatedEvent) => {
  if (localBusEnabled()) return publishLocal('invoice.created', event);
  await producer.send({
    topic: 'invoice.created',
    messages: [{ key: event.data.invoiceId, value: JSON.stringify(event) }]
  });
};

export const publishInvoiceStatusChanged = async (event: InvoiceStatusChangedEvent) => {
  if (localBusEnabled()) return publishLocal('invoice.status.changed', event);
  await producer.send({
    topic: 'invoice.status.changed',
    messages: [{ key: event.data.invoiceId, value: JSON.stringify(event) }]
  });
};
