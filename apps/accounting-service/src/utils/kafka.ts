import { Kafka, Consumer } from 'kafkajs';
import { setupCompanyCreatedConsumer } from '../consumers/companyConsumer';
import { handleVoucherClassified } from '../consumers/voucherConsumer';
import { handleBankStatementReceived } from '../consumers/bankConsumer';
import { handleInvoiceCreated, handleInvoicePaid } from '../consumers/invoiceConsumer';
import { localBusEnabled, subscribeLocal } from './localBus';

const brokers = process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['localhost:9092'];

const kafka = new Kafka({
  clientId: 'accounting-service',
  brokers: brokers
});

export const consumer: Consumer = kafka.consumer({ groupId: 'accounting-group' });

const TOPICS = ['company.created', 'voucher.classified', 'bank.statement.received', 'invoice.created', 'invoice.status.changed'];

/**
 * Luo puuttuvat topicit ennen tilausta. Tyhjässä Kafkassa topic syntyy vasta ensimmäisestä
 * viestistä, ja puuttuvan topicin tilaus kaatoi koko kuluttajan: yhtään kirjausta ei syntynyt.
 */
const ensureTopics = async () => {
  const admin = kafka.admin();
  await admin.connect();
  try {
    const existing = await admin.listTopics();
    const missing = TOPICS.filter((t) => !existing.includes(t));
    if (missing.length) {
      await admin.createTopics({ topics: missing.map((topic) => ({ topic })), waitForLeaders: true });
      console.log(`Luotiin Kafka-topicit: ${missing.join(', ')}`);
    }
  } finally {
    await admin.disconnect();
  }
};

/** Tapahtuman käsittely (sama Kafkasta ja paikalliselta väylältä). */
const dispatch = async (topic: string, eventPayload: any) => {
  if (topic === 'company.created') await setupCompanyCreatedConsumer(eventPayload);
  else if (topic === 'voucher.classified') await handleVoucherClassified(eventPayload);
  else if (topic === 'bank.statement.received') await handleBankStatementReceived(eventPayload);
  else if (topic === 'invoice.created') await handleInvoiceCreated(eventPayload);
  else if (topic === 'invoice.status.changed') await handleInvoicePaid(eventPayload);
};

export const connectConsumer = async (attempt = 1): Promise<void> => {
  // Yhden prosessin tila: ei Kafkaa, tapahtumat tulevat suoraan muilta palveluilta
  if (localBusEnabled()) {
    for (const topic of TOPICS) subscribeLocal(topic, `accounting:${topic}`, (payload) => dispatch(topic, payload));
    console.log('accounting-service: paikallinen tapahtumaväylä käytössä');
    return;
  }
  try {
    await ensureTopics();
    await consumer.connect();
    console.log('Kafka consumer connected successfully in accounting-service');

    // Subscribe to topics
    for (const topic of TOPICS) {
      await consumer.subscribe({ topic, fromBeginning: true });
    }

    // Start listening
    await consumer.run({
      eachMessage: async ({ topic, message }) => {
        try {
          if (!message.value) return;
          console.log(`Received ${topic} event`);
          await dispatch(topic, JSON.parse(message.value.toString()));
        } catch (err) {
          console.error(`Error processing message from topic ${topic}:`, err);
        }
      },
    });
  } catch (error) {
    // Kafka voi käynnistyä palvelua hitaammin: yritetään uudelleen sen sijaan että jäädään ilman kuluttajaa.
    const delay = Math.min(30, 2 ** attempt) * 1000;
    console.error(`Failed to connect Kafka consumer (yritys ${attempt}), uusi yritys ${delay / 1000} s kuluttua:`, error);
    try { await consumer.disconnect(); } catch { /* ei yhteyttä */ }
    setTimeout(() => connectConsumer(attempt + 1), delay);
  }
};

export const disconnectConsumer = async () => {
  if (localBusEnabled()) return;
  await consumer.disconnect();
};
