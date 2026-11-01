# Asunto-osakeyhtiöiden kirjanpitoautomaation järjestelmäarkkitehtuuri

## Yhteenveto

Tämä dokumentti kuvaa SaaS-pohjaisen kirjanpitoautomaatiojärjestelmän arkkitehtuurin, joka on suunniteltu palvelemaan 10-100 asunto-osakeyhtiötä. Järjestelmä keskittyy automaattiseen tiliöintiin, raportointiin ja osakasportaaliin noudattaen Suomen kirjanpitolakia ja asunto-osakeyhtiölakia.

---

## 1. Järjestelmän yleiskuvaus

### 1.1 Liiketoimintatavoitteet

- **Automaatio**: Vähentää manuaalista kirjanpitötyötä 70-80%
- **Läpinäkyvyys**: Tarjota osakkaille reaaliaikainen näkyvyys yhtiön talouteen
- **Compliance**: Varmistaa lakisääteisten vaatimusten täyttyminen automaattisesti
- **Skaalautuvuus**: Tukea 10-100 yhtiötä yhdellä instanssilla
- **Kustannustehokkuus**: SaaS-malli mahdollistaa edulliset käyttökustannukset

### 1.2 Keskeiset ominaisuudet

1. **Automaattinen tiliöinti ja kirjanpito**
   - OCR-pohjainen tositteiden tunnistus
   - ML-malli tiliöintiehdotusten tekemiseen
   - Pankkiyhteydet tiliotteiden automaattiseen hakuun
   - Sääntöpohjainen tiliöintimoottori

2. **Raportointi ja budjetointi**
   - Lakisääteiset raportit (tase, tuloslaskelma, liitetiedot)
   - Budjetin seuranta reaaliajassa
   - Ennakoiva analytiikka (kassavirtaennusteet)
   - Vertailuanalyysit vastaavien yhtiöiden kanssa

3. **Osakas- ja hallitusportaali**
   - Osakkaan oma näkymä (vastikkeet, kulutus, äänioikeus)
   - Hallituksen työkalut (päätöksenteko, hyväksynnät)
   - Dokumentinhallinta
   - Viestintätyökalut

---

## 2. Tekninen arkkitehtuuri

### 2.1 Korkean tason arkkitehtuuri

```
┌─────────────────────────────────────────────────────────────┐
│                     Käyttäjäkerros                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  Osakas-     │  │  Hallitus-   │  │  Isännöitsijä│     │
│  │  portaali    │  │  portaali    │  │  -konsoli    │     │
│  │  (React)     │  │  (React)     │  │  (React)     │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                            ↓ HTTPS/WSS
┌─────────────────────────────────────────────────────────────┐
│                    API Gateway (Kong)                       │
│         ┌────────────────────────────────────┐             │
│         │  Autentikointi & Valtuutus         │             │
│         │  Rate Limiting & Throttling        │             │
│         │  Request/Response validointi       │             │
│         └────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                  Sovelluspalvelukerros                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Kirjan-  │  │ Raportointi│ │ Laskutus │  │ ML/AI    │  │
│  │ pito     │  │ Palvelu   │  │ Palvelu  │  │ Palvelu  │  │
│  │ Palvelu  │  │           │  │          │  │          │  │
│  │ (Node.js)│  │ (Python)  │  │(Node.js) │  │ (Python) │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Tosite   │  │ Käyttäjä │  │ Dokumentti│  │ Integraatio│
│  │ Palvelu  │  │ Palvelu  │  │ Palvelu  │  │ Palvelu   │  │
│  │ (Node.js)│  │(Node.js) │  │ (Go)     │  │ (Node.js) │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    Event Bus (Kafka)                        │
│  ┌─────────────────────────────────────────────────┐       │
│  │  Tapahtumavirrat:                               │       │
│  │  - kirjaukset.luotu                             │       │
│  │  - tositteet.käsitelty                          │       │
│  │  - laskut.lähetetty                             │       │
│  │  - raportit.generoitu                           │       │
│  └─────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                      Datakerros                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  PostgreSQL  │  │    Redis     │  │     S3       │     │
│  │  (primääri   │  │   (välimuisti│  │  (dokumentit,│     │
│  │   tietokanta)│  │   & sessiot) │  │   tositteet) │     │
│  │              │  │              │  │              │     │
│  │  - Kirjanpito│  │  - Käyttäjä- │  │  - PDF-      │     │
│  │  - Yhtiöt    │  │    sessiot   │  │    tositteet │     │
│  │  - Käyttäjät │  │  - Job-jonot │  │  - Raportit  │     │
│  │  - Tositteet │  │  - API cache │  │  - Varmuus-  │     │
│  │              │  │              │  │    kopiot    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                 Ulkoiset integraatiot                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  Pankit  │  │ Verkko-  │  │ Sähköposti│ │ Verohallinto│
│  │  (API)   │  │ laskut   │  │ palvelu  │  │  (Ilmoitus│  │
│  │          │  │ (Finvoice)│  │ (SMTP)   │  │  API)     │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Mikropalveluarkkitehtuuri

#### 2.2.1 Kirjanpitopalvelu (Accounting Service)

**Vastuualueet:**
- Tiliöintien hallinta
- Päiväkirjakirjaukset
- Pääkirjapito
- Reskontra (myynti- ja ostoreskontra)
- Tilikartta ja tilirakenne

**Teknologiat:**
- Node.js + TypeScript
- PostgreSQL (transaktiokanta)
- Event sourcing -malli kirjauksille

**Rajapinnat:**
```typescript
POST   /api/v1/entries              // Luo uusi kirjaus
GET    /api/v1/entries              // Hae kirjauksia
PUT    /api/v1/entries/:id          // Päivitä kirjaus
DELETE /api/v1/entries/:id          // Poista kirjaus (vain draft)
GET    /api/v1/ledger               // Pääkirja
GET    /api/v1/chart-of-accounts    // Tilikartta
POST   /api/v1/reconciliations      // Täsmäytykset
```

#### 2.2.2 Raportointipalvelu (Reporting Service)

**Vastuualueet:**
- Lakisääteiset raportit (tase, tuloslaskelma)
- Liitetiedot
- Budjettivertailut
- Analytiikka ja ennusteet
- PDF-generointi

**Teknologiat:**
- Python 3.11+ (NumPy, Pandas analytiikkaan)
- PostgreSQL (read replica)
- Redis (tulosvälimuisti)
- WeasyPrint (PDF-generointi)

**Rajapinnat:**
```python
GET  /api/v1/reports/balance-sheet       # Tase
GET  /api/v1/reports/income-statement    # Tuloslaskelma
GET  /api/v1/reports/notes                # Liitetiedot
GET  /api/v1/reports/budget-comparison   # Budjettivertailu
POST /api/v1/reports/custom               # Räätälöity raportti
GET  /api/v1/analytics/cash-flow         # Kassavirtaennuste
```

#### 2.2.3 Laskutuspalvelu (Billing Service)

**Vastuualueet:**
- Vastikkeiden laskutus
- Maksumuistutukset
- Suoritusten kohdistus
- Verkkolaskuintegraatio
- Maksuviitteet

**Teknologiat:**
- Node.js + TypeScript
- PostgreSQL
- Bull (työjonohallinta)
- Finvoice XML (verkkolaskut)

**Rajapinnat:**
```typescript
POST /api/v1/invoices              // Luo lasku
GET  /api/v1/invoices              // Hae laskuja
POST /api/v1/invoices/batch        // Massalaskutus
POST /api/v1/payments              // Kirjaa maksu
GET  /api/v1/reminders             // Muistutukset
```

#### 2.2.4 Tositepalvelu (Voucher Service)

**Vastuualueet:**
- Tositteiden vastaanotto
- OCR-käsittely
- Tiliöintiehdotukset (ML)
- Arkistointi
- Hakutoiminnot

**Teknologiat:**
- Node.js + TypeScript
- Tesseract OCR
- Google Cloud Vision API (backup)
- S3-yhteensopiva objektisäilö
- Elasticsearch (haku)

**Rajapinnat:**
```typescript
POST /api/v1/vouchers/upload       // Lataa tosite
GET  /api/v1/vouchers              // Hae tositeita
POST /api/v1/vouchers/:id/ocr      // Käynnistä OCR
POST /api/v1/vouchers/:id/classify // ML-luokittelu
GET  /api/v1/vouchers/search       // Haku
```

#### 2.2.5 ML/AI-palvelu (ML Service)

**Vastuualueet:**
- Tiliöintiehdotusten ML-malli
- Kululuokittelu
- Anomaliantunnistus
- Kassavirtaennusteet
- Mallin uudelleenkoulutus

**Teknologiat:**
- Python 3.11+
- TensorFlow / scikit-learn
- MLflow (mallinversiointi)
- FastAPI

**Rajapinnat:**
```python
POST /api/v1/ml/classify-transaction  # Luokittele tapahtuma
POST /api/v1/ml/suggest-account       # Ehdota tiliä
GET  /api/v1/ml/anomalies             # Hae poikkeamat
POST /api/v1/ml/forecast              # Ennusta kassavirta
POST /api/v1/ml/retrain               # Kouluta malli
```

#### 2.2.6 Käyttäjäpalvelu (User Service)

**Vastuualueet:**
- Käyttäjähallinta
- Autentikointi (JWT)
- Valtuutus (RBAC)
- Osakkeiden hallinta
- Äänestysoikeudet

**Teknologiat:**
- Node.js + TypeScript
- PostgreSQL
- Redis (session store)
- bcrypt (salasanat)
- JWT (tokenien)

**Rajapinnat:**
```typescript
POST /api/v1/auth/register         // Rekisteröinti
POST /api/v1/auth/login            // Kirjautuminen
POST /api/v1/auth/refresh          // Uusi token
GET  /api/v1/users                 // Käyttäjät
POST /api/v1/shareholders          // Lisää osakas
GET  /api/v1/shareholders/:id/shares // Osakkeet
```

#### 2.2.7 Dokumenttipalvelu (Document Service)

**Vastuualueet:**
- Dokumenttien hallinta
- Versionhallinta
- Metatietojen hallinta
- Jakelulistat
- Arkistointi (10v säilytys)

**Teknologiat:**
- Go (suorituskyky)
- PostgreSQL (metadata)
- S3 (dokumentit)
- MinIO (S3-yhteensopiva)

**Rajapinnat:**
```go
POST /api/v1/documents/upload      // Lataa dokumentti
GET  /api/v1/documents             // Hae dokumentteja
GET  /api/v1/documents/:id         // Hae dokumentti
PUT  /api/v1/documents/:id         // Päivitä metadata
POST /api/v1/documents/:id/share   // Jaa dokumentti
```

#### 2.2.8 Integraatiopalvelu (Integration Service)

**Vastuualueet:**
- Pankkiyhteydet (PSD2 API)
- Verkkolaskujen vastaanotto
- Sähköpostit
- Kalenterisykronointi
- Webhookit

**Teknologiat:**
- Node.js + TypeScript
- Redis (webhook-jono)
- Nordea/OP API SDK:t

**Rajapinnat:**
```typescript
POST /api/v1/bank/connect          // Yhdistä pankkiin
GET  /api/v1/bank/transactions     // Hae tapahtumat
POST /api/v1/einvoice/receive      // Vastaanota verkkolasku
POST /api/v1/webhooks              // Rekisteröi webhook
```

---

## 3. Tietomalli

### 3.1 Keskeiset tietomallit

#### 3.1.1 Yhtiö (Company)

```typescript
interface Company {
  id: UUID;
  businessId: string;              // Y-tunnus
  name: string;
  housingCooperativeId: string;    // Yhtiön tunnus
  address: Address;
  
  // Kirjanpitoasetukset
  fiscalYearStart: Date;
  fiscalYearEnd: Date;
  chartOfAccountsTemplate: string; // TATO
  
  // Metatiedot
  createdAt: Timestamp;
  updatedAt: Timestamp;
  settings: CompanySettings;
}

interface CompanySettings {
  defaultCurrency: string;         // EUR
  vatRegistered: boolean;
  language: string;                // fi, sv, en
  timezone: string;                // Europe/Helsinki
  invoiceNumberPrefix: string;
  fiscalYearLock: boolean;
}
```

#### 3.1.2 Kirjanpitokirjaus (AccountingEntry)

```typescript
interface AccountingEntry {
  id: UUID;
  companyId: UUID;
  entryDate: Date;
  voucherNumber: string;
  description: string;
  
  // Rivit (debet/kredit)
  lines: AccountingLine[];
  
  // Liitteet
  vouchers: UUID[];                // Viittaukset tositeisiin
  
  // Tila
  status: 'draft' | 'posted' | 'locked';
  postedBy: UUID;
  postedAt: Timestamp;
  
  // Audit trail
  createdBy: UUID;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  version: number;
}

interface AccountingLine {
  id: UUID;
  accountNumber: string;           // Tilinumero
  debit: Decimal;                  // Debet
  credit: Decimal;                 // Kredit
  description: string;
  costCenter?: string;
  project?: string;
  vatCode?: string;
  vatAmount?: Decimal;
}
```

#### 3.1.3 Osakas (Shareholder)

```typescript
interface Shareholder {
  id: UUID;
  companyId: UUID;
  
  // Henkilötiedot
  personType: 'individual' | 'company';
  firstName?: string;
  lastName?: string;
  companyName?: string;
  personalId?: string;             // Henkilötunnus
  businessId?: string;             // Y-tunnus
  
  // Yhteystiedot
  email: string;
  phone: string;
  address: Address;
  
  // Osakkeet
  shares: Share[];
  
  // Käyttäjätili
  userId?: UUID;
  
  // Metatiedot
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface Share {
  id: UUID;
  shareNumbers: string[];          // Osakkeiden numerot (esim. "1-100")
  apartment: Apartment;
  ownershipStart: Date;
  ownershipEnd?: Date;
  ownershipPercentage: Decimal;    // Jos osaomistus
}

interface Apartment {
  number: string;                  // Huoneiston numero
  address: string;
  floor: number;
  rooms: number;
  squareMeters: Decimal;
  shareOfCommonExpenses: Decimal;  // Vastikeosuus
}
```

#### 3.1.4 Lasku (Invoice)

```typescript
interface Invoice {
  id: UUID;
  companyId: UUID;
  shareholderId: UUID;
  
  // Laskun tiedot
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate: Date;
  referenceNumber: string;         // Viitenumero
  
  // Rivit
  lines: InvoiceLine[];
  
  // Summat
  subtotal: Decimal;
  vatAmount: Decimal;
  total: Decimal;
  
  // Tila
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  sentAt?: Timestamp;
  paidAt?: Timestamp;
  paidAmount?: Decimal;
  
  // Muistutukset
  remindersSent: number;
  lastReminderSent?: Timestamp;
  
  // Metatiedot
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface InvoiceLine {
  id: UUID;
  description: string;
  quantity: Decimal;
  unitPrice: Decimal;
  vatRate: Decimal;
  amount: Decimal;
  accountNumber: string;           // Kirjanpidon tili
  type: 'maintenance_fee' | 'water' | 'heating' | 'other';
}
```

#### 3.1.5 Tosite (Voucher)

```typescript
interface Voucher {
  id: UUID;
  companyId: UUID;
  
  // Tositteen tiedot
  voucherType: 'purchase' | 'sale' | 'bank' | 'other';
  voucherDate: Date;
  supplier?: string;
  customer?: string;
  amount: Decimal;
  vatAmount?: Decimal;
  
  // Tiedostot
  files: VoucherFile[];
  
  // OCR ja ML
  ocrStatus: 'pending' | 'processing' | 'completed' | 'failed';
  ocrData?: OCRData;
  mlClassification?: MLClassification;
  
  // Tiliöinti
  suggestedAccount?: string;
  accountingEntryId?: UUID;        // Linkki kirjaukseen
  
  // Tila
  status: 'unprocessed' | 'classified' | 'posted' | 'archived';
  
  // Metatiedot
  uploadedBy: UUID;
  uploadedAt: Timestamp;
  processedAt?: Timestamp;
}

interface VoucherFile {
  id: UUID;
  filename: string;
  mimeType: string;
  size: number;
  s3Key: string;
  s3Bucket: string;
  checksum: string;                // SHA-256
}

interface OCRData {
  text: string;
  confidence: Decimal;
  fields: {
    invoiceNumber?: string;
    date?: Date;
    amount?: Decimal;
    supplier?: string;
    iban?: string;
  };
}

interface MLClassification {
  predictedAccount: string;
  confidence: Decimal;
  topPredictions: Array<{
    account: string;
    confidence: Decimal;
  }>;
}
```

### 3.2 Tietokantarakenne (PostgreSQL)

```sql
-- Yhtiöt
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id VARCHAR(9) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  housing_cooperative_id VARCHAR(50),
  fiscal_year_start DATE NOT NULL,
  fiscal_year_end DATE NOT NULL,
  chart_of_accounts_template VARCHAR(50) DEFAULT 'TATO',
  settings JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tilikartta
CREATE TABLE chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  account_number VARCHAR(10) NOT NULL,
  account_name VARCHAR(255) NOT NULL,
  account_type VARCHAR(50) NOT NULL, -- asset, liability, equity, revenue, expense
  parent_account VARCHAR(10),
  is_active BOOLEAN DEFAULT TRUE,
  UNIQUE(company_id, account_number)
);

-- Kirjanpitokirjaukset
CREATE TABLE accounting_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  entry_date DATE NOT NULL,
  voucher_number VARCHAR(50) NOT NULL,
  description TEXT,
  status VARCHAR(20) DEFAULT 'draft', -- draft, posted, locked
  posted_by UUID,
  posted_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  version INTEGER DEFAULT 1,
  UNIQUE(company_id, voucher_number)
);

-- Kirjanpitorivit
CREATE TABLE accounting_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID REFERENCES accounting_entries(id) ON DELETE CASCADE,
  account_number VARCHAR(10) NOT NULL,
  debit DECIMAL(15,2) DEFAULT 0,
  credit DECIMAL(15,2) DEFAULT 0,
  description TEXT,
  cost_center VARCHAR(50),
  project VARCHAR(50),
  vat_code VARCHAR(10),
  vat_amount DECIMAL(15,2),
  CHECK (debit >= 0 AND credit >= 0),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);

-- Indeksit suorituskyvylle
CREATE INDEX idx_entries_company_date ON accounting_entries(company_id, entry_date);
CREATE INDEX idx_entries_status ON accounting_entries(status);
CREATE INDEX idx_lines_entry ON accounting_lines(entry_id);
CREATE INDEX idx_lines_account ON accounting_lines(account_number);

-- Osakkaat
CREATE TABLE shareholders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  person_type VARCHAR(20) NOT NULL, -- individual, company
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  company_name VARCHAR(255),
  personal_id VARCHAR(11),
  business_id VARCHAR(9),
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  address JSONB,
  user_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Osakkeet
CREATE TABLE shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shareholder_id UUID REFERENCES shareholders(id),
  share_numbers VARCHAR(100) NOT NULL, -- "1-100"
  apartment JSONB NOT NULL,
  ownership_start DATE NOT NULL,
  ownership_end DATE,
  ownership_percentage DECIMAL(5,4) DEFAULT 1.0000
);

-- Laskut
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  shareholder_id UUID REFERENCES shareholders(id),
  invoice_number VARCHAR(50) NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  reference_number VARCHAR(20) NOT NULL,
  subtotal DECIMAL(15,2) NOT NULL,
  vat_amount DECIMAL(15,2) DEFAULT 0,
  total DECIMAL(15,2) NOT NULL,
  status VARCHAR(20) DEFAULT 'draft',
  sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  paid_amount DECIMAL(15,2),
  reminders_sent INTEGER DEFAULT 0,
  last_reminder_sent TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, invoice_number)
);

-- Laskurivit
CREATE TABLE invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  description VARCHAR(255) NOT NULL,
  quantity DECIMAL(10,2) NOT NULL,
  unit_price DECIMAL(15,2) NOT NULL,
  vat_rate DECIMAL(5,2) NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  account_number VARCHAR(10),
  line_type VARCHAR(50)
);

-- Tositteet
CREATE TABLE vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  voucher_type VARCHAR(50) NOT NULL,
  voucher_date DATE NOT NULL,
  supplier VARCHAR(255),
  customer VARCHAR(255),
  amount DECIMAL(15,2),
  vat_amount DECIMAL(15,2),
  ocr_status VARCHAR(20) DEFAULT 'pending',
  ocr_data JSONB,
  ml_classification JSONB,
  suggested_account VARCHAR(10),
  accounting_entry_id UUID REFERENCES accounting_entries(id),
  status VARCHAR(20) DEFAULT 'unprocessed',
  uploaded_by UUID NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- Tositetiedostot
CREATE TABLE voucher_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id UUID REFERENCES vouchers(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size BIGINT NOT NULL,
  s3_key VARCHAR(500) NOT NULL,
  s3_bucket VARCHAR(100) NOT NULL,
  checksum VARCHAR(64) NOT NULL
);

-- Audit log (kirjausketju)
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  action VARCHAR(50) NOT NULL, -- create, update, delete
  user_id UUID NOT NULL,
  changes JSONB,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_timestamp ON audit_log(timestamp);
```

---

## 4. Tietoturva ja compliance

### 4.1 Autentikointi ja valtuutus

#### 4.1.1 Autentikointi

- **JWT-tokenien** käyttö (access + refresh token)
- **MFA (Multi-Factor Authentication)** pakollinen hallituksen jäsenille
- **OAuth2/OIDC** integraatio (Google, Microsoft)
- **Salasanavarasto**: bcrypt + salt (cost factor 12)

#### 4.1.2 Valtuutus (RBAC)

```typescript
enum Role {
  SUPER_ADMIN = 'super_admin',      // Järjestelmävalvoja
  COMPANY_ADMIN = 'company_admin',  // Yhtiön pääkäyttäjä
  BOARD_MEMBER = 'board_member',    // Hallituksen jäsen
  PROPERTY_MANAGER = 'property_manager', // Isännöitsijä
  SHAREHOLDER = 'shareholder',      // Osakas
  ACCOUNTANT = 'accountant',        // Kirjanpitäjä
  VIEWER = 'viewer'                 // Lukuoikeus
}

interface Permission {
  resource: string;                 // esim. 'accounting_entries'
  action: 'create' | 'read' | 'update' | 'delete';
  condition?: string;               // esim. 'own_company_only'
}

const rolePermissions: Record<Role, Permission[]> = {
  [Role.SHAREHOLDER]: [
    { resource: 'invoices', action: 'read', condition: 'own_only' },
    { resource: 'shares', action: 'read', condition: 'own_only' },
    { resource: 'documents', action: 'read', condition: 'public_only' },
  ],
  [Role.BOARD_MEMBER]: [
    { resource: 'accounting_entries', action: 'read' },
    { resource: 'reports', action: 'read' },
    { resource: 'invoices', action: 'read' },
    { resource: 'vouchers', action: 'read' },
    { resource: 'documents', action: 'create' },
    { resource: 'documents', action: 'read' },
  ],
  [Role.ACCOUNTANT]: [
    { resource: 'accounting_entries', action: 'create' },
    { resource: 'accounting_entries', action: 'read' },
    { resource: 'accounting_entries', action: 'update', condition: 'draft_only' },
    { resource: 'vouchers', action: 'create' },
    { resource: 'vouchers', action: 'read' },
    { resource: 'vouchers', action: 'update' },
    { resource: 'reports', action: 'read' },
  ],
  // ... muut roolit
};
```

### 4.2 Tietosuoja (GDPR)

#### 4.2.1 Henkilötietojen käsittely

- **Tietosuojaseloste** selkeästi saatavilla
- **Suostumusten hallinta** käyttäjäkohtaisesti
- **Oikeus tietoihin** (data export JSON/CSV)
- **Oikeus poistoon** (anonymisointi, ei täydellistä poistoa kirjanpitolain vuoksi)
- **Tietojen siirrettävyys** (API + standardimuodot)

#### 4.2.2 Tietojen minimoiminen

- Kerätään vain **välttämättömät tiedot**
- Henkilötunnuksia **ei tallenneta** suoraan (hash)
- Lokitiedot **anonymisoidaan** 90 päivän jälkeen

### 4.3 Tietoturva

#### 4.3.1 Salaus

- **TLS 1.3** kaikessa liikenteessä
- **At-rest encryption** tietokannoille (AWS RDS encryption)
- **S3 bucket encryption** (AES-256)
- **Salausavaimet**: AWS KMS tai HashiCorp Vault

#### 4.3.2 Tietokannan suojaus

- **Connection pooling** + SSL-yhteydet
- **Prepared statements** (SQL injection esto)
- **Row-level security** (PostgreSQL RLS)
- **Database backups**: päivittäin, säilytys 30pv

#### 4.3.3 API-turvallisuus

- **Rate limiting**: 100 req/min per käyttäjä
- **Request validation**: JSON Schema
- **CORS**: whitelisted domains
- **Security headers**: HSTS, CSP, X-Frame-Options

#### 4.3.4 Haavoittuvuuksien hallinta

- **Dependency scanning** (Snyk, Dependabot)
- **SAST/DAST** (SonarQube, OWASP ZAP)
- **Penetraatiotestausta** 2x vuodessa
- **Bug bounty** -ohjelma (tulevaisuudessa)

### 4.4 Compliance

#### 4.4.1 Kirjanpitolaki (1336/1997)

**Vaatimukset:**
- Kirjausten **kronologisuus** ja **muuttumattomuus**
- **Tositteen pysyvyys** (ei voi muuttaa jälkikäteen)
- **Kirjausketjun** säilytys (audit trail)
- **Arkistointi** 10 vuotta (6v + 4v jälkeen tilikauden päättymistä)
- **Juokseva numerointi** tositteille

**Toteutus:**
```typescript
// Event sourcing -malli: kirjauksia ei koskaan muuteta, vain lisätään
interface AccountingEvent {
  id: UUID;
  eventType: 'EntryCreated' | 'EntryAmended' | 'EntryCorrected';
  timestamp: Timestamp;
  userId: UUID;
  data: any;
  previousEventId?: UUID;
}

// Kirjausketju
class AuditTrail {
  logChange(entityType: string, entityId: UUID, action: string, changes: any) {
    const log = {
      entity_type: entityType,
      entity_id: entityId,
      action: action,
      user_id: getCurrentUser().id,
      changes: changes,
      timestamp: new Date(),
    };
    db.audit_log.insert(log);
  }
}

// Tilikauden lukitus
function lockFiscalYear(companyId: UUID, fiscalYear: number) {
  db.companies.update({
    where: { id: companyId },
    data: { 
      settings: { 
        lockedFiscalYears: [...existing, fiscalYear] 
      } 
    }
  });
}
```

#### 4.4.2 Asunto-osakeyhtiölaki (1599/2009)

**Vaatimukset:**
- **Osakeluettelo** ajan tasalla
- **Yhtiöjärjestys** saatavilla
- **Hallituksen päätökset** dokumentoitava
- **Tilinpäätöksen hyväksyminen** yhtiökokouksessa
- **Osakkaiden tiedonsaantioikeus**

**Toteutus:**
- Osakeluettelo päivittyy automaattisesti
- Dokumentinhallinta hallituksen materiaaleille
- Äänestystyökalu yhtiökokouksiin
- Osakasportaali tiedonsaantiin

#### 4.4.3 TATO (Taloyhtiön tilikartta)

**Käyttö:**
- **Standardoitu tilikartta** kaikille taloyhtiöille
- **Yhtenäiset raportit** vertailukelpoisuuden vuoksi
- **Päivitykset** automaattisesti uusiin versioihin

```typescript
const TATO_ACCOUNTS = {
  '1000': 'Maa-alueet',
  '1010': 'Rakennukset ja rakennelmat',
  '1020': 'Koneet ja kalusto',
  // ... kaikki TATO-tilit
  '9000': 'Tilikauden tulos',
};
```

---

## 5. Skaalaavuus ja suorituskyky

### 5.1 Vaakasuuntainen skaalautuvuus

#### 5.1.1 Mikropalveluiden skaalaus

```yaml
# Kubernetes deployment esimerkki
apiVersion: apps/v1
kind: Deployment
metadata:
  name: accounting-service
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
  template:
    spec:
      containers:
      - name: accounting-service
        image: accounting-service:latest
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: accounting-service-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: accounting-service
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

#### 5.1.2 Tietokanta-skaalaus

- **Read replicas**: raportointi ja analytiikka
- **Connection pooling**: PgBouncer
- **Sharding**: yhtiökohtainen (company_id)
- **Caching**: Redis (hot data)

```typescript
// Read/write splitting
class DatabaseRouter {
  write(query: string, params: any[]) {
    return primaryDB.execute(query, params);
  }
  
  read(query: string, params: any[]) {
    // Load balance between replicas
    const replica = this.getRandomReplica();
    return replica.execute(query, params);
  }
}

// Caching strategy
class CacheStrategy {
  async getAccountingEntry(id: UUID): Promise<AccountingEntry> {
    const cacheKey = `entry:${id}`;
    
    // Try cache first
    let entry = await redis.get(cacheKey);
    if (entry) return JSON.parse(entry);
    
    // Cache miss - fetch from DB
    entry = await db.accounting_entries.findUnique({ where: { id } });
    
    // Store in cache (TTL 1 hour)
    await redis.setex(cacheKey, 3600, JSON.stringify(entry));
    
    return entry;
  }
}
```

### 5.2 Suorituskykyoptimointia

#### 5.2.1 API-optimointi

- **GraphQL** monimutkaisten kyselyiden osalta
- **Pagination**: cursor-based (tehokkaampi kuin offset)
- **Field selection**: palauta vain pyydetyt kentät
- **Batch loading**: DataLoader (N+1 ongelman esto)

```typescript
// GraphQL resolver with DataLoader
const shareholderLoader = new DataLoader(async (ids: UUID[]) => {
  const shareholders = await db.shareholders.findMany({
    where: { id: { in: ids } }
  });
  return ids.map(id => shareholders.find(s => s.id === id));
});

const resolvers = {
  Invoice: {
    shareholder: (invoice) => {
      return shareholderLoader.load(invoice.shareholderId);
    }
  }
};
```

#### 5.2.2 Raporttien optimointi

- **Pre-computation**: ajoitetut työt raskaiden raporttien laskemiseen
- **Materialized views**: PostgreSQL
- **Incremental updates**: vain muuttuneet tiedot

```sql
-- Materialized view kuukausiraporteille
CREATE MATERIALIZED VIEW monthly_income_statement AS
SELECT 
  company_id,
  DATE_TRUNC('month', entry_date) as month,
  account_number,
  SUM(debit - credit) as balance
FROM accounting_lines l
JOIN accounting_entries e ON l.entry_id = e.id
WHERE e.status = 'posted'
GROUP BY company_id, month, account_number;

-- Päivitä öisin
CREATE INDEX idx_monthly_income ON monthly_income_statement(company_id, month);
REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_income_statement;
```

#### 5.2.3 OCR ja ML optimointi

- **Batch processing**: käsittele tositteet ryppäinä
- **Async processing**: työjonot (Bull/BullMQ)
- **GPU acceleration**: ML-mallien inferenssiin (tulevaisuudessa)

```typescript
// Batch OCR processing
class OCRProcessor {
  async processBatch(voucherIds: UUID[]) {
    const queue = new Bull('ocr-queue', {
      redis: redisConfig,
      limiter: {
        max: 10,      // 10 työstä kerrallaan
        duration: 1000 // per sekunti
      }
    });
    
    for (const id of voucherIds) {
      await queue.add('process-voucher', { voucherId: id });
    }
  }
}

// Worker
queue.process('process-voucher', async (job) => {
  const { voucherId } = job.data;
  const voucher = await db.vouchers.findUnique({ where: { id: voucherId } });
  
  // Run OCR
  const ocrResult = await ocrService.extractText(voucher.files[0]);
  
  // Run ML classification
  const classification = await mlService.classifyTransaction(ocrResult);
  
  // Update voucher
  await db.vouchers.update({
    where: { id: voucherId },
    data: {
      ocr_status: 'completed',
      ocr_data: ocrResult,
      ml_classification: classification,
      suggested_account: classification.predictedAccount
    }
  });
});
```

### 5.3 Monitorointi ja observability

#### 5.3.1 Metrics (Prometheus)

```typescript
import { Counter, Histogram, Gauge } from 'prom-client';

// Counters
const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status']
});

// Histograms (latency)
const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency',
  labelNames: ['method', 'route'],
  buckets: [0.1, 0.5, 1, 2, 5]
});

// Gauges
const activeConnections = new Gauge({
  name: 'active_database_connections',
  help: 'Active database connections'
});
```

#### 5.3.2 Logging (ELK Stack)

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'accounting-service' },
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Structured logging
logger.info('Accounting entry created', {
  companyId: company.id,
  entryId: entry.id,
  amount: entry.total,
  userId: user.id
});
```

#### 5.3.3 Tracing (Jaeger/Zipkin)

```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('accounting-service');

async function createAccountingEntry(data: any) {
  const span = tracer.startSpan('create_accounting_entry');
  
  try {
    // Validate
    const validationSpan = tracer.startSpan('validate_entry', { parent: span });
    await validateEntry(data);
    validationSpan.end();
    
    // Save to DB
    const dbSpan = tracer.startSpan('save_to_database', { parent: span });
    const entry = await db.accounting_entries.create({ data });
    dbSpan.end();
    
    // Emit event
    const eventSpan = tracer.startSpan('emit_event', { parent: span });
    await eventBus.publish('accounting.entry.created', entry);
    eventSpan.end();
    
    return entry;
  } finally {
    span.end();
  }
}
```

---

## 6. DevOps ja deployment

### 6.1 CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run tests
        run: |
          npm install
          npm test
          npm run test:e2e
      - name: Coverage
        run: npm run coverage
      - name: SonarQube scan
        run: sonar-scanner

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Build Docker image
        run: |
          docker build -t accounting-service:${{ github.sha }} .
      - name: Push to registry
        run: |
          docker push accounting-service:${{ github.sha }}

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to Kubernetes
        run: |
          kubectl set image deployment/accounting-service \
            accounting-service=accounting-service:${{ github.sha }}
          kubectl rollout status deployment/accounting-service
```

### 6.2 Infrastruktuuri (Terraform)

```hcl
# main.tf
provider "aws" {
  region = "eu-north-1"  # Stockholm (lähin Suomeen)
}

# VPC
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "3.14.0"
  
  name = "housing-coop-vpc"
  cidr = "10.0.0.0/16"
  
  azs             = ["eu-north-1a", "eu-north-1b", "eu-north-1c"]
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]
  
  enable_nat_gateway = true
  enable_dns_hostnames = true
}

# EKS Cluster
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "18.26.0"
  
  cluster_name    = "housing-coop-cluster"
  cluster_version = "1.27"
  
  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets
  
  eks_managed_node_groups = {
    general = {
      desired_size = 3
      min_size     = 3
      max_size     = 10
      
      instance_types = ["t3.medium"]
      capacity_type  = "ON_DEMAND"
    }
  }
}

# RDS PostgreSQL
resource "aws_db_instance" "primary" {
  identifier        = "housing-coop-db"
  engine            = "postgres"
  engine_version    = "15.3"
  instance_class    = "db.t3.medium"
  allocated_storage = 100
  storage_encrypted = true
  
  db_name  = "housing_coop"
  username = var.db_username
  password = var.db_password
  
  vpc_security_group_ids = [aws_security_group.db.id]
  db_subnet_group_name   = aws_db_subnet_group.main.name
  
  backup_retention_period = 30
  backup_window          = "03:00-04:00"
  maintenance_window     = "mon:04:00-mon:05:00"
  
  multi_az               = true
  skip_final_snapshot    = false
  final_snapshot_identifier = "housing-coop-db-final-snapshot"
}

# Read replica
resource "aws_db_instance" "replica" {
  identifier             = "housing-coop-db-replica"
  replicate_source_db    = aws_db_instance.primary.identifier
  instance_class         = "db.t3.medium"
  publicly_accessible    = false
  skip_final_snapshot    = true
}

# ElastiCache Redis
resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "housing-coop-redis"
  engine               = "redis"
  node_type            = "cache.t3.micro"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  engine_version       = "7.0"
  port                 = 6379
  
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.redis.id]
}

# S3 Buckets
resource "aws_s3_bucket" "documents" {
  bucket = "housing-coop-documents"
  
  versioning {
    enabled = true
  }
  
  server_side_encryption_configuration {
    rule {
      apply_server_side_encryption_by_default {
        sse_algorithm = "AES256"
      }
    }
  }
  
  lifecycle_rule {
    enabled = true
    
    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }
    
    transition {
      days          = 365
      storage_class = "GLACIER"
    }
  }
}

# CloudFront CDN
resource "aws_cloudfront_distribution" "main" {
  enabled = true
  
  origin {
    domain_name = aws_s3_bucket.documents.bucket_regional_domain_name
    origin_id   = "S3-documents"
    
    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.main.cloudfront_access_identity_path
    }
  }
  
  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-documents"
    
    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
    
    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
  }
  
  restrictions {
    geo_restriction {
      restriction_type = "whitelist"
      locations        = ["FI", "SE", "NO", "DK"]
    }
  }
  
  viewer_certificate {
    acm_certificate_arn = aws_acm_certificate.main.arn
    ssl_support_method  = "sni-only"
  }
}
```

### 6.3 Varmuuskopiointi

```typescript
// Backup strategy
class BackupStrategy {
  // Database backups
  async backupDatabase() {
    // RDS automatic backups (daily, 30 day retention)
    // Additional manual snapshots for important milestones
    
    const snapshot = await rds.createDBSnapshot({
      DBInstanceIdentifier: 'housing-coop-db',
      DBSnapshotIdentifier: `manual-snapshot-${Date.now()}`
    });
    
    return snapshot;
  }
  
  // Document backups
  async backupDocuments() {
    // S3 versioning enabled
    // Cross-region replication to eu-west-1 (Ireland)
    
    await s3.putBucketReplication({
      Bucket: 'housing-coop-documents',
      ReplicationConfiguration: {
        Role: replicationRoleArn,
        Rules: [{
          Status: 'Enabled',
          Destination: {
            Bucket: 'arn:aws:s3:::housing-coop-documents-backup'
          }
        }]
      }
    });
  }
  
  // Application state backups
  async backupRedis() {
    // Redis persistence (RDB + AOF)
    // Daily snapshots to S3
    
    const dump = await redis.bgsave();
    await s3.upload({
      Bucket: 'housing-coop-backups',
      Key: `redis/dump-${Date.now()}.rdb`,
      Body: dump
    });
  }
}

// Disaster recovery
class DisasterRecovery {
  async restoreFromBackup(backupId: string) {
    // 1. Restore database from snapshot
    await rds.restoreDBInstanceFromDBSnapshot({
      DBInstanceIdentifier: 'housing-coop-db-restored',
      DBSnapshotIdentifier: backupId
    });
    
    // 2. Restore documents from S3 versioning
    // 3. Restore Redis from latest dump
    // 4. Update DNS to point to restored instance
    // 5. Notify stakeholders
  }
  
  // RTO: 4 hours
  // RPO: 1 hour (point-in-time recovery)
}
```

---

## 7. Integraatiot

### 7.1 Pankkiyhteydet (PSD2)

```typescript
// Nordea Open Banking API
class NordeaIntegration {
  private accessToken: string;
  
  async authenticate() {
    const response = await fetch('https://api.nordeaopenbanking.com/v3/authorize', {
      method: 'POST',
      headers: {
        'X-IBM-Client-Id': process.env.NORDEA_CLIENT_ID,
        'X-IBM-Client-Secret': process.env.NORDEA_CLIENT_SECRET,
      },
      body: JSON.stringify({
        redirect_uri: 'https://app.taloyhtion-kirjanpito.fi/callback',
        scope: 'ACCOUNTS_BASIC ACCOUNTS_BALANCES ACCOUNTS_DETAILS ACCOUNTS_TRANSACTIONS PAYMENTS_MULTIPLE'
      })
    });
    
    this.accessToken = response.access_token;
  }
  
  async getAccounts(companyId: UUID) {
    const response = await fetch('https://api.nordeaopenbanking.com/v3/accounts', {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'X-IBM-Client-Id': process.env.NORDEA_CLIENT_ID,
      }
    });
    
    return response.accounts;
  }
  
  async getTransactions(accountId: string, from: Date, to: Date) {
    const response = await fetch(
      `https://api.nordeaopenbanking.com/v3/accounts/${accountId}/transactions` +
      `?fromDate=${from.toISOString()}&toDate=${to.toISOString()}`,
      {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'X-IBM-Client-Id': process.env.NORDEA_CLIENT_ID,
        }
      }
    );
    
    return response.transactions;
  }
  
  async syncTransactions(companyId: UUID) {
    const accounts = await this.getAccounts(companyId);
    
    for (const account of accounts) {
      const lastSync = await getLastSyncDate(companyId, account.id);
      const transactions = await this.getTransactions(
        account.id,
        lastSync,
        new Date()
      );
      
      // Create vouchers from transactions
      for (const transaction of transactions) {
        await this.createVoucherFromTransaction(companyId, transaction);
      }
      
      await updateLastSyncDate(companyId, account.id, new Date());
    }
  }
  
  private async createVoucherFromTransaction(companyId: UUID, transaction: any) {
    const voucher = await db.vouchers.create({
      data: {
        company_id: companyId,
        voucher_type: 'bank',
        voucher_date: new Date(transaction.valueDate),
        supplier: transaction.creditorName || transaction.debtorName,
        amount: Math.abs(transaction.amount),
        status: 'unprocessed',
        uploaded_by: 'system',
      }
    });
    
    // Trigger ML classification
    await mlService.classifyTransaction(voucher.id);
  }
}

// OP (Osuuspankki) integration - similar pattern
class OPIntegration {
  // Similar implementation using OP's API
}
```

### 7.2 Verkkolaskut (Finvoice)

```typescript
// Finvoice XML integration
class FinvoiceIntegration {
  async receiveInvoice(xml: string) {
    // Parse Finvoice XML
    const parser = new XMLParser();
    const invoice = parser.parse(xml);
    
    // Extract invoice data
    const data = {
      supplier: invoice.SellerPartyDetails.SellerOrganisationName,
      invoiceNumber: invoice.InvoiceNumber,
      invoiceDate: new Date(invoice.InvoiceDate),
      dueDate: new Date(invoice.PaymentTermsDetails.InvoiceDueDate),
      amount: parseFloat(invoice.InvoiceTotalVatIncludedAmount),
      vatAmount: parseFloat(invoice.InvoiceTotalVatAmount),
      iban: invoice.PaymentTermsDetails.SellersBankAccount.BankAccountNumber,
      reference: invoice.PaymentTermsDetails.PaymentReferenceNumber,
    };
    
    // Create voucher
    const voucher = await db.vouchers.create({
      data: {
        company_id: this.determineCompany(invoice),
        voucher_type: 'purchase',
        voucher_date: data.invoiceDate,
        supplier: data.supplier,
        amount: data.amount,
        vat_amount: data.vatAmount,
        status: 'unprocessed',
        uploaded_by: 'finvoice-system',
      }
    });
    
    // Store XML as file
    await this.storeXML(voucher.id, xml);
    
    // Trigger ML classification
    await mlService.classifyTransaction(voucher.id);
    
    return voucher;
  }
  
  async sendInvoice(invoiceId: UUID) {
    const invoice = await db.invoices.findUnique({
      where: { id: invoiceId },
      include: { lines: true, shareholder: true, company: true }
    });
    
    // Generate Finvoice XML
    const xml = this.generateFinvoiceXML(invoice);
    
    // Send to operator
    await this.sendToOperator(xml, invoice.shareholder.finvoiceAddress);
    
    // Update invoice status
    await db.invoices.update({
      where: { id: invoiceId },
      data: { status: 'sent', sent_at: new Date() }
    });
  }
  
  private generateFinvoiceXML(invoice: any): string {
    const builder = new XMLBuilder({ format: true });
    
    const finvoice = {
      Finvoice: {
        '@xmlns': 'urn:finvoice:schema:invoice:3.0',
        SellerPartyDetails: {
          SellerOrganisationName: invoice.company.name,
          SellerOrganisationTaxCode: invoice.company.business_id,
        },
        BuyerPartyDetails: {
          BuyerOrganisationName: invoice.shareholder.company_name || 
            `${invoice.shareholder.first_name} ${invoice.shareholder.last_name}`,
          BuyerPostalAddressDetails: invoice.shareholder.address,
        },
        InvoiceDetails: {
          InvoiceTypeCode: 'INV01',
          InvoiceNumber: invoice.invoice_number,
          InvoiceDate: invoice.invoice_date.toISOString().split('T')[0],
          OriginCode: 'Original',
        },
        InvoiceRow: invoice.lines.map((line: any) => ({
          ArticleName: line.description,
          OrderedQuantity: line.quantity,
          UnitPriceAmount: line.unit_price,
          RowVatRatePercent: line.vat_rate,
          RowAmount: line.amount,
        })),
        InvoiceTotalVatExcludedAmount: invoice.subtotal,
        InvoiceTotalVatAmount: invoice.vat_amount,
        InvoiceTotalVatIncludedAmount: invoice.total,
        PaymentTermsDetails: {
          InvoiceDueDate: invoice.due_date.toISOString().split('T')[0],
          PaymentReferenceNumber: invoice.reference_number,
          SellersBankAccount: {
            BankAccountNumber: invoice.company.settings.bank_account,
          }
        }
      }
    };
    
    return builder.build(finvoice);
  }
  
  private async sendToOperator(xml: string, finvoiceAddress: string) {
    // Send to e-invoice operator (e.g. Maventa, Basware)
    await fetch('https://api.operator.fi/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
        'X-Operator-Key': process.env.OPERATOR_API_KEY,
      },
      body: xml
    });
  }
}
```

### 7.3 Sähköposti

```typescript
// Email service
class EmailService {
  private transporter: nodemailer.Transporter;
  
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      }
    });
  }
  
  async sendInvoice(invoiceId: UUID) {
    const invoice = await db.invoices.findUnique({
      where: { id: invoiceId },
      include: { shareholder: true, company: true }
    });
    
    // Generate PDF
    const pdf = await reportingService.generateInvoicePDF(invoice);
    
    // Send email
    await this.transporter.sendMail({
      from: `${invoice.company.name} <noreply@taloyhtion-kirjanpito.fi>`,
      to: invoice.shareholder.email,
      subject: `Lasku ${invoice.invoice_number} - ${invoice.company.name}`,
      html: this.getInvoiceEmailTemplate(invoice),
      attachments: [{
        filename: `lasku_${invoice.invoice_number}.pdf`,
        content: pdf,
        contentType: 'application/pdf'
      }]
    });
    
    // Log email
    await db.email_log.create({
      data: {
        invoice_id: invoiceId,
        recipient: invoice.shareholder.email,
        subject: `Lasku ${invoice.invoice_number}`,
        sent_at: new Date(),
      }
    });
  }
  
  async sendReminder(invoiceId: UUID) {
    const invoice = await db.invoices.findUnique({
      where: { id: invoiceId },
      include: { shareholder: true, company: true }
    });
    
    const daysOverdue = Math.floor(
      (Date.now() - invoice.due_date.getTime()) / (1000 * 60 * 60 * 24)
    );
    
    await this.transporter.sendMail({
      from: `${invoice.company.name} <noreply@taloyhtion-kirjanpito.fi>`,
      to: invoice.shareholder.email,
      subject: `Maksumuistutus - Lasku ${invoice.invoice_number}`,
      html: this.getReminderEmailTemplate(invoice, daysOverdue),
    });
    
    // Update invoice
    await db.invoices.update({
      where: { id: invoiceId },
      data: {
        reminders_sent: invoice.reminders_sent + 1,
        last_reminder_sent: new Date(),
      }
    });
  }
  
  private getInvoiceEmailTemplate(invoice: any): string {
    return `
      <h2>Hyvä ${invoice.shareholder.first_name} ${invoice.shareholder.last_name},</h2>
      <p>Liitteenä löydät laskun ${invoice.invoice_number} yhtiöltä ${invoice.company.name}.</p>
      <p><strong>Eräpäivä:</strong> ${invoice.due_date.toLocaleDateString('fi-FI')}</p>
      <p><strong>Summa:</strong> ${invoice.total.toFixed(2)} €</p>
      <p><strong>Viitenumero:</strong> ${invoice.reference_number}</p>
      <p>Voit myös tarkastella laskua ja maksaa sen osakasportaalissa: 
         <a href="https://app.taloyhtion-kirjanpito.fi/invoices/${invoice.id}">Avaa portaalissa</a>
      </p>
      <p>Ystävällisin terveisin,<br>${invoice.company.name}</p>
    `;
  }
}
```

---

## 8. Kustannusarvio

### 8.1 Infrastruktuurikustannukset (AWS, 50 yhtiötä)

| Palvelu | Kuvaus | Kuukausikustannus (€) |
|---------|--------|----------------------|
| **EKS Cluster** | 3x t3.medium nodes | 120 |
| **RDS PostgreSQL** | db.t3.medium + replica | 180 |
| **ElastiCache Redis** | cache.t3.micro | 25 |
| **S3 Storage** | 500 GB dokumentteja | 12 |
| **CloudFront CDN** | Data transfer | 30 |
| **Load Balancer** | Application LB | 25 |
| **Data Transfer** | Outbound | 40 |
| **Backup Storage** | Snapshots | 30 |
| **CloudWatch** | Logs + Metrics | 20 |
| **Route53** | DNS | 5 |
| **Yhteensä** | | **~487 €/kk** |

### 8.2 Kolmannen osapuolen palvelut

| Palvelu | Kuvaus | Kuukausikustannus (€) |
|---------|--------|----------------------|
| **Google Cloud Vision** | OCR (backup) | 50 |
| **SendGrid** | Transactional email | 30 |
| **Sentry** | Error tracking | 29 |
| **Datadog** | Monitoring (valinnainen) | 150 |
| **GitHub** | CI/CD | 0 (Actions free tier) |
| **Yhteensä** | | **~109-259 €/kk** |

### 8.3 Henkilöstökustannukset (tiimi)

| Rooli | Henkilömäärä | Kuukausipalkka (€) | Yhteensä (€) |
|-------|--------------|-------------------|--------------|
| **Full-stack Developer** | 2 | 5500 | 11 000 |
| **Backend Developer** | 1 | 5500 | 5 500 |
| **DevOps Engineer** | 1 | 6000 | 6 000 |
| **Product Manager** | 0.5 | 5000 | 2 500 |
| **Customer Support** | 1 | 3500 | 3 500 |
| **Yhteensä** | 5.5 | | **28 500 €/kk** |

### 8.4 Hinnoittelumalli (asiakkaille)

**Porrastettu hinnoittelu:**

| Taloyhtiön koko | Kuukausihinta (€/kk) | Vuosihinta (€/v) |
|-----------------|---------------------|------------------|
| **1-20 asuntoa** | 99 | 990 |
| **21-50 asuntoa** | 149 | 1 490 |
| **51-100 asuntoa** | 249 | 2 490 |
| **Yli 100 asuntoa** | Tarjous | Tarjous |

**Lisäpalvelut:**
- **Premium-tuki**: +50 €/kk (priorisoitu tuki, omistettu asiakaspäällikkö)
- **Integraatiot**: +30 €/kk (pankkiyhteydet, verkkolaskut)
- **Analytiikka**: +40 €/kk (edistynyt analytiikka, benchmarking)

**Kannattavuuslaskenta (50 yhtiötä, keskikoko 35 asuntoa):**
- Tuotot: 50 × 149 € = 7 450 €/kk
- Infra: 487 €/kk
- Palvelut: 109 €/kk
- Henkilöstö: 28 500 €/kk
- **Kustannukset yhteensä**: 29 096 €/kk
- **Voitto**: -21 646 €/kk (ei kannattava vielä)

**Kannattavuusraja:** ~200 yhtiötä (29 800 €/kk tuottoja)

---

## 9. Kehityspolku ja roadmap

### 9.1 Vaihe 1: MVP (6 kuukautta)

**Tavoite**: Toimiva perusversio 5-10 pilottiyhtiölle

**Toiminnallisuudet:**
- ✅ Käyttäjähallinta ja autentikointi
- ✅ Peruskirjanpito (manuaalinen tiliöinti)
- ✅ Vastikkeiden laskutus
- ✅ Yksinkertainen raportointi (tase, tuloslaskelma)
- ✅ Tositteiden lataus ja arkistointi
- ✅ Osakasportaali (laskujen näyttö)

**Teknologiat:**
- Node.js + PostgreSQL
- React (frontend)
- Yksinkertainen deployment (Heroku / DigitalOcean)

**Tavoitteet:**
- 10 pilottiyhtiötä
- Perustellut käyttäjäpalautteet
- Validoitu liiketoimintamalli

### 9.2 Vaihe 2: Automaatio (6 kuukautta)

**Tavoite**: Automaattinen tiliöinti ja ML-integraatiot

**Uudet toiminnallisuudet:**
- ✅ OCR-tositteiden käsittelyyn
- ✅ ML-malli tiliöintiehdotuksiin
- ✅ Pankkiyhteydet (PSD2 API)
- ✅ Verkkolaskujen vastaanotto
- ✅ Kassavirtaennusteet
- ✅ Budjetointi

**Skaalaus:**
- Mikropalveluarkkitehtuuri
- Kubernetes deployment
- CI/CD pipeline

**Tavoitteet:**
- 30-50 yhtiötä
- 70% automaatioaste
- Positiivinen kassavirta

### 9.3 Vaihe 3: Analytiikka (6 kuukautta)

**Tavoite**: Edistynyt analytiikka ja benchmarking

**Uudet toiminnallisuudet:**
- ✅ Vertailuanalyysit vastaavien yhtiöiden kanssa
- ✅ Kustannusten optimointiehdotukset
- ✅ Ennakoiva ylläpito (kunnossapitosuunnittelu)
- ✅ Dashboardit hallitukselle
- ✅ Mobile app (iOS/Android)

**Integraatiot:**
- Kiinteistönhoitojärjestelmät
- Energiaseuranta
- Huoltokirjat

**Tavoitteet:**
- 100+ yhtiötä
- Kannattavuusraja saavutettu
- Toimitiimin kasvu

### 9.4 Vaihe 4: Ekosysteemi (jatkuva)

**Tavoite**: Alusta ja partner-ekosysteemi

**Uudet toiminnallisuudet:**
- ✅ API marketplace (kolmannen osapuolen integraatiot)
- ✅ Yhtiökokouksen äänestystyökalu
- ✅ Remonttien hallinta
- ✅ Vuokranmaksun seuranta
- ✅ AI-assistentti (chatbot)

**Laajentuminen:**
- Pohjoismaihin (Ruotsi, Norja)
- Uudet asiakassegmentit (kiinteistöyhtiöt)

**Tavoitteet:**
- 500+ yhtiötä
- Merkittävä markkinaosuus Suomessa
- Kansainvälinen laajennus

---

## 10. Riskit ja haasteet

### 10.1 Tekniset riskit

| Riski | Todennäköisyys | Vaikutus | Mitigaatio |
|-------|----------------|----------|------------|
| **Tietoturvaloukkaus** | Matala | Kriittinen | Penetraatiotestausta, bug bounty, 24/7 monitoring |
| **Tietokantakorruptio** | Matala | Korkea | Päivittäiset varmuuskopiot, read replicas |
| **API-integraatioiden rikkoontuminen** | Keskitaso | Keskitaso | Versiointi, fallback-mekanismit, testaus |
| **Skaalautuvuusongelmat** | Keskitaso | Keskitaso | Load testing, horizontal scaling, caching |
| **ML-mallin epätarkkuus** | Korkea | Matala | Ihmisen vahvistus, jatkuva uudelleenkoulutus |

### 10.2 Liiketoimintariskit

| Riski | Todennäköisyys | Vaikutus | Mitigaatio |
|-------|----------------|----------|------------|
| **Asiakashankinta hidas** | Keskitaso | Korkea | Partnerisuhteet isännöintitoimistoihin |
| **Kilpailijat** | Korkea | Keskitaso | Differointi (ML, UX), nopea kehitys |
| **Lainsäädännön muutokset** | Matala | Korkea | Compliance-tiimi, lakimieskonsultit |
| **Asiakkaiden resistance to change** | Korkea | Keskitaso | Pilotointi, hyvä onboarding, koulutus |

### 10.3 Compliance-riskit

| Riski | Todennäköisyys | Vaikutus | Mitigaatio |
|-------|----------------|----------|------------|
| **GDPR-rikkomus** | Matala | Kriittinen | DPO, tietosuoja-auditoinnit |
| **Kirjanpitolain rikkomus** | Matala | Korkea | Jatkuva compliance-seuranta, KHT-tilintarkastaja |
| **Arkistointivaatimusten laiminlyönti** | Matala | Korkea | Automaattinen arkistointi, 10v säilytys |

---

## 11. Yhteenveto ja seuraavat askeleet

### 11.1 Yhteenveto

Tämä arkkitehtuuri kuvaa modernin, skaalautuvan SaaS-järjestelmän asunto-osakeyhtiöiden kirjanpitoautomaatioon. Keskeiset vahvuudet:

1. **Mikropalveluarkkitehtuuri** mahdollistaa joustavan kehityksen ja skaalautuvuuden
2. **ML/AI-integraatiot** automaatisoivat rutiinityöt
3. **Lakisääteinen compliance** sisäänrakennettuna
4. **Käyttäjäystävällisyys** kaikille sidosryhmille
5. **Kustannustehokkuus** SaaS-mallissa

### 11.2 Seuraavat askeleet

**Välittömät toimenpiteet (0-3 kuukautta):**

1. **Tiimin kokoaminen**
   - Palkkaa 2 full-stack developeria
   - Palkkaa 1 DevOps engineer
   - Ota yhteyttä potentiaalisiin pilottiasiakkaisiin

2. **MVP-kehitys**
   - Setup dev-ympäristö
   - Toteuta käyttäjähallinta
   - Toteuta peruskirjanpito
   - Toteuta laskutus

3. **Juridiikka**
   - Hanki lakimieskonsultaatio (GDPR, kirjanpitolaki)
   - Laadi käyttöehdot ja tietosuojaseloste
   - Valmistele pilottisopimukset

**Keskipitkän aikavälin (3-12 kuukautta):**

1. **Pilotointi**
   - Rekrytoi 5-10 pilottiyhtiötä
   - Kerää käyttäjäpalautetta
   - Iteroi tuotetta

2. **Rahoitus**
   - Hae Business Finland -tukea
   - Neuvottele sijoittajien kanssa (seed-kierros)
   - Valmistele kassavirtasuunnitelma

3. **Skaalaus**
   - Toteuta mikropalvelut
   - Setup production-ympäristö
   - Aloita markkinointi

**Pitkän aikavälin (1-3 vuotta):**

1. **Kasvattaminen**
   - Tavoittele 100+ yhtiötä
   - Laajenna Pohjoismaihin
   - Rakenna partner-ekosysteemi

2. **Exit-strategia**
   - Valmistaudu Series A -rahoitukseen
   - Harkitse yritysostoa suuremmalta toimijalta
   - Tai jatka orgaanista kasvua

---

## 12. Liitteet

### 12.1 Teknologiapino

**Frontend:**
- React 18+
- TypeScript
- Tailwind CSS
- React Query (state management)
- Recharts (visualisoinnit)

**Backend:**
- Node.js 20+ / TypeScript
- Python 3.11+ (ML/raportointi)
- Go 1.21+ (dokumenttipalvelu)
- PostgreSQL 15+
- Redis 7+

**Infrastruktuuri:**
- Kubernetes (EKS)
- Terraform
- Docker
- Kafka (event bus)
- MinIO / S3

**Monitorointi:**
- Prometheus + Grafana
- ELK Stack
- Jaeger (tracing)
- Sentry (error tracking)

### 12.2 Käsitteet

- **TATO**: Taloyhtiön tilikartta (standardoitu tilikartta asunto-osakeyhtiöille)
- **PSD2**: Payment Services Directive 2 (maksupalveludirektiivi, mahdollistaa pankkiyhteydet)
- **Finvoice**: Suomalainen verkkolaskustandardi
- **OCR**: Optical Character Recognition (tekstintunnistus)
- **ML**: Machine Learning (koneoppiminen)
- **RBAC**: Role-Based Access Control (roolipohjainen käyttöoikeushallinta)
- **Event Sourcing**: Arkkitehtuurimalli, jossa tila johdetaan tapahtumista
- **CQRS**: Command Query Responsibility Segregation (komento-kyselyvastuiden erottaminen)

### 12.3 Viitteet

- Kirjanpitolaki (1336/1997): https://www.finlex.fi/fi/laki/ajantasa/1997/19971336
- Asunto-osakeyhtiölaki (1599/2009): https://www.finlex.fi/fi/laki/ajantasa/2009/20091599
- GDPR: https://gdpr.eu/
- PSD2: https://www.finanssivalvonta.fi/kuluttajansuoja/maksut/psd2/
- TATO tilikartta: https://www.taloyhtio.net/tato/

---

**Dokumentin versio**: 1.0  
**Päivämäärä**: 2026-04-19  
**Laatija**: Claude  
**Tila**: Luonnos
