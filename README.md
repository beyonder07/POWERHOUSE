# Gym Management System (Desktop-First Hybrid)

This repository now contains all major architecture pieces:

- Desktop source-of-truth app (Electron + Next.js + SQLite)
- Cloud backend (Express + MongoDB)
- Remote read-only PWA (Next.js)

## Implemented

### Phase 1 (Complete)
- Desktop shell + local database
- Member management
- Local security boundaries (secure preload IPC)
- Input validation + audit logs
- Zod-based IPC payload validation for mutation/read payload channels
- IPC channel allowlist in preload bridge

### Phase 2 (Complete)
- Payments + attendance
- Split-payment recording support (`payment_splits` table)
- Invoice PDF generation (Electron native `webContents.printToPDF`)
- Manual + automatic backups
- Backup restore and retention pruning
- Optional offsite backup copy path (for synced drive / network storage)
- Dues and late-fee rules
- PIN lock + session timeout
- Membership freeze/pause controls (freeze window + expiry shift + unfreeze)
- Daily Z-report API (cash vs digital reconciliation)

### Phase 3 (Implemented Baseline)
- Notification engine (expiry + overdue sweeps)
- Real provider adapters for:
  - WhatsApp Cloud API
  - Twilio SMS
- Notification logs + manual trigger API
- Daily desktop notification scheduler (9:00 AM)
- Startup catch-up sweep when app was offline during scheduled window
- Dispatch mode selector (`desktop` or `cloud`) to prevent duplicate sends
- Durable local `notification_queue` with retry persistence (crash-safe delivery retries)

### Phase 4 (Implemented Baseline)
- Local sync payload builder (desktop)
- Configurable cloud sync settings (URL/token/HMAC/interval/masking)
- Manual + scheduled sync runs
- Sync logs/status APIs with:
  - idempotency keys
  - HMAC request signatures with timestamp validation
  - retry with exponential backoff
  - durable outbox queue for failed pushes
  - manual failed-item retry controls
  - sync circuit-breaker (failure streak threshold + cooldown)
- Cloud backend auth + sync ingest endpoints
- Incremental sync mode using local `updated_at` cursor (delta push after first full sync)
- Cloud snapshot merge for delta payloads (desktop remains source of truth)
- Cloud-side notification queue + worker:
  - durable Mongo jobs
  - idempotent enqueue on each sync
  - retry with backoff
  - runs even when desktop app is offline (when dispatch mode is `cloud`)

### Phase 5 (Implemented Baseline)
- Remote PWA login with access+refresh token lifecycle
- Read-only dashboard
- Member lookup
- Payment summary view
- Expiring-member list
- Manifest + service worker registration

## Structure

- `electron/` - desktop app runtime modules
- `cloud-backend/` - cloud ingest and remote data API
- `remote-pwa/` - remote read-only PWA

## Desktop Commands

```powershell
npm install
npm run dev
npm run build
```

## Windows Installer (Electron)

Build unsigned installer and unpacked app:

```powershell
npm run dist:win
```

Additional build targets:

```powershell
npm run dist:win:portable
npm run dist:win:dir
```

Artifacts are generated in `dist/`.

### Code Signing (Windows)

To sign installer/exe, configure a valid code-signing `.pfx` certificate:

```powershell
$env:CSC_LINK="C:\\certs\\your-cert.pfx"
$env:CSC_KEY_PASSWORD="your-pfx-password"
npm run dist:win:signed
```

If `CSC_LINK`/`CSC_KEY_PASSWORD` are not set, build output is unsigned.

## Notification Provider Env (Desktop)

Set these in your desktop runtime environment before running:

```powershell
# WhatsApp Cloud API
$env:WHATSAPP_CLOUD_ACCESS_TOKEN="..."
$env:WHATSAPP_CLOUD_PHONE_NUMBER_ID="..."
$env:WHATSAPP_CLOUD_API_VERSION="v22.0"

# Twilio SMS
$env:TWILIO_ACCOUNT_SID="..."
$env:TWILIO_AUTH_TOKEN="..."
$env:TWILIO_FROM_NUMBER="+1xxxxxxxxxx"
```

If credentials are missing, notifications run in `simulated` mode.

## Cloud Backend Commands

```powershell
npm --prefix cloud-backend install
copy cloud-backend\.env.example cloud-backend\.env
npm --prefix cloud-backend run dev
```

Cloud sync endpoint now enforces idempotency key (`x-idempotency-key`) and deduplicates repeated pushes.
Cloud sync endpoint also verifies HMAC signature headers:

- `x-sync-timestamp`
- `x-sync-signature`
- shared secret from `SYNC_HMAC_SECRET` (cloud) and Desktop Settings -> Sync -> `Sync HMAC Secret`

Optional cloud notification worker can be enabled from `cloud-backend/.env`:

- `CLOUD_NOTIFICATIONS_ENABLED=1`
- Configure one provider:
  - WhatsApp Cloud: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`
  - Twilio SMS: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`

Cloud auth now supports token lifecycle hardening:

- short-lived access tokens (`JWT_ACCESS_TTL`)
- refresh-token rotation (`/api/auth/refresh`)
- access-token revocation (`/api/auth/logout`)
- role-based access controls (`admin` / `staff` plus legacy aliases)

## Remote PWA Commands

```powershell
npm --prefix remote-pwa install
copy remote-pwa\.env.example remote-pwa\.env
npm --prefix remote-pwa run dev
```

## Run Everything Together

```powershell
npm run dev:all
```

## Important

- Desktop remains source of truth.
- Remote cloud data is synced projection only.
- If desktop is down, local automations are paused. Cloud sync/notification services continue if cloud worker is enabled and data was already synced.
- Cloud backend currently requires MongoDB connection.
- Sensitive sync credentials are encrypted at rest in local settings storage (Electron safeStorage when available).
- Data-at-rest baseline uses OS-level encryption attempt on Windows (EFS directory encryption + health visibility).
- Payment create flow is transactional (payment + invoice link + audit in one DB transaction).
- Member phone uniqueness is enforced at DB level when no legacy duplicates exist.
- DB integrity check runs at startup; if local DB is corrupt, app attempts auto-recovery from latest valid backup.
- Backup restore validates SQLite integrity before allowing restore.
- WAL checkpoint is dynamically triggered by WAL growth/age instead of fixed-only interval.
- Sync payload generation is offloaded to a worker thread (with fallback) to reduce main-process UI freezes on large datasets.
- Desktop members/payments tables are paginated to reduce render lag for large gyms.
- System health metrics are exposed to UI (sync failures/outbox pressure/notification failures/backup status).

## Tests

```powershell
npm run test
```

Includes:
- Desktop sync circuit-breaker unit tests
- Cloud sync signature verification unit tests


<!-- START_STATS_SECTION -->
### 📊 Auto-Update Stats
- **Last Active:** 8/14/2026, 11:11:44 AM
- **Latest Focus:** CI/CD Workflows with GitHub Actions
- **Current Streak Status:** Active 🔥
- **Commit Mode:** Automated Daily Log System
<!-- END_STATS_SECTION -->
