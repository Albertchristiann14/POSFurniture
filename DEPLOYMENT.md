# Buku Panduan Deployment & Operasional Produksi: Krevia POS (Furniture Edition)

Dokumen ini merupakan panduan resmi arsitektur, konfigurasi keamanan, dan prosedur operasional sistem **Krevia POS** untuk lingkungan produksi.

---

## 1. Arsitektur & Spesifikasi Sistem

### Komponen Inti:
- **Web App / API Engine**: Next.js 15 (App Router) + TypeScript Strict Mode.
- **Database Primer**: PostgreSQL 16 (dengan dukungan UUIDv4, Partial Unique Indexes, dan Row-Level Security).
- **Cache, Lock & Rate Limiter**: Redis 7 Alpine (Redlock distributed lock & Token Bucket rate limiting).
- **Penyimpanan Dokumen**: MinIO / AWS S3 kompatibel dengan enkripsi at-rest untuk berkas nasabah (KTP, slip gaji).
- **Worker & Background Jobs**: BullMQ didukung Redis untuk eksekusi job harian denda, pengingat, dan rekonsiliasi.

### Rekomendasi Spesifikasi Server (Produksi):
- **CPU**: Minimal 4 vCPU (Disarankan 8 vCPU untuk skala multi-outlet).
- **RAM**: Minimal 8 GB RAM (Disarankan 16 GB).
- **Storage**: SSD NVMe minimal 100 GB (dengan IOPS tinggi untuk PostgreSQL & Append-Only Ledger).
- **OS**: Ubuntu 22.04 LTS / Debian 12 / Rocky Linux 9 dengan Docker & Docker Compose v2.

---

## 2. Persiapan Environment & Manajemen Rahasia (Secrets)

Buat file `.env.production` di root server dengan parameter wajib berikut:

```bash
NODE_ENV=production
PORT=3000
APP_URL=https://pos.krevia.com

# PostgreSQL Connection
DATABASE_URL="postgresql://krevia_user:STRONG_SECURE_PASSWORD@postgres:5432/krevia_pos?schema=public&connection_limit=25&pool_timeout=10"

# Redis
REDIS_URL="redis://:STRONG_REDIS_PASSWORD@redis:6379"

# Enkripsi Data Pribadi (UU PDP Indonesia No. 27/2022)
# WAJIB 64 karakter Hex (32 bytes) acak kriptografis
DATA_ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
BLIND_INDEX_SALT="krevia_production_blind_index_salt_keep_strictly_secret_2026"

# Kunci Enkripsi Backup
BACKUP_ENCRYPTION_KEY="fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"

# JWT & Otentikasi Staf
JWT_SECRET="krevia_production_super_jwt_secret_staff_pos_furniture"
SESSION_EXPIRY_HOURS=12

# Object Storage S3 / MinIO
STORAGE_DRIVER=s3
S3_ENDPOINT=https://s3.ap-southeast-1.amazonaws.com # atau MinIO endpoint
S3_BUCKET=krevia-secure-documents
S3_ACCESS_KEY=YOUR_S3_ACCESS_KEY
S3_SECRET_KEY=YOUR_S3_SECRET_KEY
S3_REGION=ap-southeast-1

# Payment Gateway
PAYMENT_GATEWAY_PROVIDER=MIDTRANS
MIDTRANS_SERVER_KEY="Mid-server-YOUR_PRODUCTION_SERVER_KEY"
MIDTRANS_CLIENT_KEY="Mid-client-YOUR_PRODUCTION_CLIENT_KEY"
MIDTRANS_IS_PRODUCTION=true
```

> **PERINGATAN KEAMANAN**: Jangan pernah memasukkan nilai secret di atas ke dalam Git repository. Gunakan Secret Manager (misal AWS Secrets Manager, Vault, atau GitHub Secrets) saat deploy CI/CD.

---

## 3. Langkah-Langkah Deployment via Docker

### A. Clone & Konfigurasi
```bash
git clone https://github.com/Albertchristiann14/POSFurniture.git /opt/krevia-pos
cd /opt/krevia-pos
cp .env.example .env.production
# Edit nilai .env.production dengan kunci produksi
```

### B. Build & Jalankan Kontainer
```bash
docker compose up -d --build
```

### C. Migrasi Skema Database & Inisialisasi
```bash
docker compose exec app npx prisma db push
```

---

## 4. Konfigurasi Row-Level Security (RLS) PostgreSQL

Untuk menjamin isolasi multi-tenant pada level engine database terendah (*defense-in-depth*), jalankan skrip SQL berikut pada PostgreSQL produksi:

```sql
-- Aktifkan RLS pada tabel-tabel multi-tenant
ALTER TABLE credit_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger_batches ENABLE ROW LEVEL SECURITY;

-- Buat Kebijakan Isolasi Tenant
CREATE POLICY tenant_isolation_policy ON credit_customers
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_policy ON credit_contracts
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_policy ON orders
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_policy ON payments
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_policy ON credit_ledger_batches
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true));
```

---

## 5. Prosedur Backup & Restore Terenkripsi (Disaster Recovery)

### A. Jadwal Backup Otomatis Harian (Cron)
Tambahkan entri cronjob pada server produksi untuk mengeksekusi backup setiap pukul 02:00 WIB:

```bash
# Buka crontab
crontab -e

# Tambahkan baris:
0 2 * * * cd /opt/krevia-pos && docker compose exec -T postgres pg_dump -U krevia_user krevia_pos | npx tsx scripts/backup.ts >> /var/log/krevia-backup.log 2>&1
```

Setiap file backup otomatis dienkripsi dengan **AES-256-GCM** dan menghasilkan metadata SHA-256 checksum di `/opt/krevia-pos/storage/backups`.

### B. Prosedur Uji Restore (Disaster Recovery Runbook)
1. Salin berkas backup `.sql.enc` dan `.meta.json` ke server pemulihan.
2. Jalankan perintah dekripsi dan validasi integritas checksum:
   ```bash
   npx tsx scripts/restore.ts storage/backups/backup-krevia-pos-2026-11-03.sql.enc
   ```
3. Salurkan output SQL yang telah didekripsi langsung ke PostgreSQL:
   ```bash
   npx tsx scripts/restore.ts storage/backups/backup-krevia-pos-2026-11-03.sql.enc | docker compose exec -T postgres psql -U krevia_user -d krevia_pos
   ```

---

## 6. Verifikasi Health Check & Monitoring

- **Endpoint Status Aplikasi**: `GET https://pos.krevia.com/` (Respons 200 OK).
- **Simulasi API**: `POST https://pos.krevia.com/api/credit/simulate` (Validasi Zod & Kalkulasi integer).
- **Log Terstruktur**: Log aplikasi menggunakan JSON terformat dengan `correlationId` unik dan masking otomatis untuk data kredensial/PIN.
- **Webhook Endpoint**: `POST https://pos.krevia.com/api/webhooks/payment/midtrans` (Verifikasi signature SHA-512 wajib).
