FROM python:3.11-slim

WORKDIR /app

# Install dependencies required for psycopg2 to build if needed, though we use binary
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Wait for DB script (optional but good practice for docker-compose)
# For simplicity, we just run seed.py then main app. 
# But let's build a small entrypoint shell script to ensure it seeds automatically.

# Create an entrypoint
RUN echo '#!/bin/bash\n\
python seed.py\n\
exec uvicorn main:app --host 0.0.0.0 --port 8000\n\
' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

EXPOSE 8000

CMD ["/app/entrypoint.sh"]
