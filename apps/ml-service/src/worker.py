import asyncio
import json
import os
import uuid
from dotenv import load_dotenv
from datetime import datetime, timezone
import boto3
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from classifier import SUSPENSE_ACCOUNT, match_keywords

load_dotenv()

# Configuration
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "http://localhost:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "admin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "password")

s3_client = boto3.client(
    's3',
    endpoint_url=MINIO_ENDPOINT,
    aws_access_key_id=MINIO_ACCESS_KEY,
    aws_secret_access_key=MINIO_SECRET_KEY,
    region_name='us-east-1'
)

async def classify_voucher(filename):
    """
    Mock classification logic based on filename keywords
    In a real app, we would download the file and run OCR/TensorFlow
    """
    matches = match_keywords(filename)
    if matches:
        return matches[0]["code"], 0.9
    return SUSPENSE_ACCOUNT["code"], 0.5

async def run_worker():
    consumer = AIOKafkaConsumer(
        "voucher.uploaded",
        bootstrap_servers=KAFKA_BROKERS,
        group_id="ml-service-group"
    )
    
    producer = AIOKafkaProducer(bootstrap_servers=KAFKA_BROKERS)
    
    await consumer.start()
    await producer.start()
    
    print("ML Service Worker started, listening to voucher.uploaded...")
    
    try:
        async for msg in consumer:
            print(f"Consumed message: {msg.topic}")
            event = json.loads(msg.value.decode("utf-8"))
            
            voucher_id = event["data"]["voucherId"]
            company_id = event["data"]["companyId"]
            filename = event["data"]["filename"]
            
            print(f"Processing voucher {voucher_id} for company {company_id}")
            
            # Simulate processing time
            await asyncio.sleep(1)
            
            suggested_account, confidence = await classify_voucher(filename)
            
            # Publish classification result
            classified_event = {
                "id": str(uuid.uuid4()),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "data": {
                    "voucherId": voucher_id,
                    "companyId": company_id,
                    "suggestedAccount": suggested_account,  # camelCase: accounting-service lukee tätä nimeä
                    "confidence": confidence,
                    # Summa ja toimittaja saadaan vasta OCR:stä. Aiemmin tässä oli kiinteä
                    # 100.0 €, joka päätyi kirjanpitoon oikean näköisenä vientinä.
                    "supplier": None,
                    "amount": None
                }
            }
            
            await producer.send_and_wait(
                "voucher.classified",
                json.dumps(classified_event).encode("utf-8"),
                key=voucher_id.encode("utf-8")
            )
            print(f"Published voucher.classified for voucher {voucher_id}")
            
    finally:
        await consumer.stop()
        await producer.stop()

if __name__ == "__main__":
    asyncio.run(run_worker())
