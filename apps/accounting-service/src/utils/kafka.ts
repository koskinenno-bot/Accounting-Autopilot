import { Kafka, Consumer } from 'kafkajs';
import { setupCompanyCreatedConsumer } from '../consumers/companyConsumer';
import { handleVoucherClassified } from '../consumers/voucherConsumer';
import { handleBankStatementReceived } from '../consumers/bankConsumer';
import { handleInvoiceCreated, handleInvoicePaid } from '../consumers/invoiceConsumer';

const brokers = process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['localhost:9092'];

const kafka = new Kafka({
  clientId: 'accounting-service',
  brokers: brokers
});

export const consumer: Consumer = kafka.consumer({ groupId: 'accounting-group' });

export const connectConsumer = async () => {
  try {
    await consumer.connect();
    console.log('Kafka consumer connected successfully in accounting-service');
    
    // Subscribe to topics
    await consumer.subscribe({ topic: 'company.created', fromBeginning: true });
    await consumer.subscribe({ topic: 'voucher.classified', fromBeginning: true });
    await consumer.subscribe({ topic: 'bank.statement.received', fromBeginning: true });
    await consumer.subscribe({ topic: 'invoice.created', fromBeginning: true });
    await consumer.subscribe({ topic: 'invoice.status.changed', fromBeginning: true });
    
    // Start listening
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          if (topic === 'company.created' && message.value) {
            console.log(`Received company.created event`);
            const eventPayload = JSON.parse(message.value.toString());
            await setupCompanyCreatedConsumer(eventPayload);
          } else if (topic === 'voucher.classified' && message.value) {
            console.log(`Received voucher.classified event`);
            const eventPayload = JSON.parse(message.value.toString());
            await handleVoucherClassified(eventPayload);
          } else if (topic === 'bank.statement.received' && message.value) {
            console.log(`Received bank.statement.received event`);
            const eventPayload = JSON.parse(message.value.toString());
            await handleBankStatementReceived(eventPayload);
          } else if (topic === 'invoice.created' && message.value) {
            console.log(`Received invoice.created event`);
            const eventPayload = JSON.parse(message.value.toString());
            await handleInvoiceCreated(eventPayload);
          } else if (topic === 'invoice.status.changed' && message.value) {
            console.log(`Received invoice.status.changed event`);
            const eventPayload = JSON.parse(message.value.toString());
            await handleInvoicePaid(eventPayload);
          }
        } catch (err) {
          console.error(`Error processing message from topic ${topic}:`, err);
        }
      },
    });
  } catch (error) {
    console.error('Failed to connect Kafka consumer:', error);
  }
};

export const disconnectConsumer = async () => {
  await consumer.disconnect();
};
