#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE user_service;
    CREATE DATABASE accounting_service;
    CREATE DATABASE voucher_service;
    CREATE DATABASE billing_service;
    CREATE DATABASE document_service;
    CREATE DATABASE common_audit_log;
    CREATE DATABASE notification_service;
    CREATE DATABASE bank_service;
EOSQL
