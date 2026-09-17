# OmniPark

## 1. Project Overview & Pitch

**OmniPark — Full-Stack Automated Parking Operations & Dynamic Pricing Engine** is a parking-garage command center for attendants and commercial parking operators.

It solves the operational problems that make a busy garage difficult to run:

- Prevents two attendants from assigning the same bay during concurrent check-ins.
- Keeps EV vehicles in EV-capable bays.
- Tracks active sessions, assigned spots, entry times, exits, and fees.
- Calculates tiered rates, daily caps, partial-hour rounding, and configurable rate cards.
- Provides a floor-aware spot map, EV availability counter, ticket search, and paginated parking logs.
- Supports correction workflows for lost plates, valet hand-offs, stale sessions, and wrongly assigned bays.

### Architecture

OmniPark uses:

- **Next.js App Router** for the dashboard and server-side route handlers.
- **Prisma ORM** for typed relational queries and transactions.
- **SQLite** for zero-configuration, file-based persistence during local development and evaluation.
- **Tailwind CSS** for the responsive operator console.

The system is designed for **any garage, not one**. The seeded 15 spots are only sample data. `GarageSettings`, `Spot`, `RateCard`, and `Ticket` allow operators to configure identity, floors, capacity, spot types, and pricing without changing application code.

### Repository layout

```text
.
├── lib/                         # Shared Prisma and fee modules
├── prisma/                      # SQLite schema and seed script
├── app/api/                     # Shared route implementations
└── parking-app/                 # Runnable Next.js App Router application
      └── app/                     # UI and thin API route entrypoints
```

The root route files contain the shared implementation. The `parking-app/app/api` files re-export those handlers so the runnable Next.js application serves them.

## 2. Quickstart & Local Setup Guide

### Prerequisites

- Node.js 18 or newer
- npm
- GitHub Codespaces or a local Unix-like terminal for the commands below

### Install dependencies

From the repository root:

```bash
npm install
cd parking-app
npm install
cd ..
```

The root package contains Prisma, Prisma Client, `tsx`, and the seed script. The nested package contains Next.js, React, TypeScript, Tailwind, and ESLint.

### Create the SQLite database

```bash
npx prisma generate
npx prisma db push
```

The database is created at `prisma/dev.db`. It is local development state and should not be committed.

### Seed the database

```bash
npx tsx prisma/seed.ts
```

The seed creates:

- Attendant email: `attendant@garage.com`
- Attendant password: `admin123`
- Five EV spots: `EV-1` through `EV-5`
- Five compact spots: `C-1` through `C-5`
- Five standard spots: `S-1` through `S-5`

The password is stored as a bcrypt hash. Change the seeded credential before production use.

### Run the development server

The Next.js application is nested under `parking-app`:

```bash
npm --prefix parking-app run dev
```

Access the dashboard at:

```text
http://localhost:3000
```

If port 3000 is already occupied, Next.js selects another available port. The terminal output is the source of truth for the active URL.

### Validate the application

```bash
npx prisma validate
npm --prefix parking-app run lint
npm --prefix parking-app run build
git diff --check
```

## 3. REST API Specification

All JSON endpoints use `Content-Type: application/json` for request bodies. Successful responses are JSON. Error responses generally use:

```json
{
   "error": "Human-readable error message"
}
```

The examples below use `http://localhost:3000` as the base URL.

### Authentication

#### `POST /api/auth/login`

Validates an attendant's bcrypt-hashed password.

Request:

```json
{
   "email": "attendant@garage.com",
   "password": "admin123"
}
```

Success `200`:

```json
{
   "success": true,
   "session": {
      "userId": "uuid",
      "email": "attendant@garage.com"
   }
}
```

Statuses: `200` success, `400` invalid JSON or missing fields, `401` invalid credentials.

#### `POST /api/auth/register`

Creates an attendant account. Passwords must contain at least eight characters and are hashed before storage.

Request:

```json
{
   "email": "operator@example.com",
   "password": "securepass123"
}
```

Success `201`:

```json
{
   "success": true,
   "session": {
      "userId": "uuid",
      "email": "operator@example.com"
   }
}
```

Statuses: `201` created, `400` invalid input, `409` email already registered.

> Production note: login currently returns a session payload but does not yet issue a signed cookie or bearer token. Add session middleware before exposing protected admin operations publicly.

### Garage settings

#### `GET /api/settings`

Returns the singleton garage configuration, creating defaults if necessary.

Success `200`:

```json
{
   "id": "default",
   "name": "OmniPark Garage",
   "address": "",
   "taxId": "",
   "floorCount": 1,
   "updatedAt": "2026-09-17T12:00:00.000Z"
}
```

#### `PATCH /api/settings`

Updates any supplied garage fields.

Request:

```json
{
   "name": "Central City Garage",
   "address": "12 Main Street",
   "taxId": "GST-12345",
   "floorCount": 3
}
```

Success `200`: returns the updated settings object. Statuses: `200` success, `400` invalid input.

### Slot capacity and layout

#### `GET /api/spots`

Returns aggregate counts, available EV bays, and the raw floor-aware spot array. Occupied spots include their latest ACTIVE ticket's plate and entry time.

Query parameters: none.

Success `200`:

```json
{
   "total": 15,
   "occupied": 1,
   "available": 14,
   "byType": {
      "EV": { "total": 5, "occupied": 1, "available": 4 },
      "COMPACT": { "total": 5, "occupied": 0, "available": 5 },
      "STANDARD": { "total": 5, "occupied": 0, "available": 5 }
   },
   "availableEvSpots": [
      {
         "id": "uuid",
         "number": "EV-2",
         "floor": 1,
         "type": "EV",
         "status": "AVAILABLE",
         "tickets": []
      }
   ],
   "spots": []
}
```

#### `POST /api/spots`

Bulk-creates available spots for a configured floor and type.

Request:

```json
{
   "floor": 2,
   "type": "EV",
   "count": 10
}
```

Success `201`:

```json
{
   "success": true,
   "spots": [
      {
         "id": "uuid",
         "number": "F2-EV-1",
         "floor": 2,
         "type": "EV",
         "status": "AVAILABLE"
      }
   ]
}
```

Accepted types: `EV`, `COMPACT`, `STANDARD`. Statuses: `201` created, `400` invalid input or floor, `500` database failure.

#### `PATCH /api/spots`

Marks a non-occupied spot as `AVAILABLE` or `MAINTENANCE`.

Request:

```json
{
   "id": "spot-uuid",
   "status": "MAINTENANCE"
}
```

Success `200`: returns the updated spot. Statuses: `200` success, `400` invalid input, `404` spot missing, `409` occupied spot.

#### `DELETE /api/spots`

Removes a non-occupied spot from capacity.

Request:

```json
{
   "id": "spot-uuid"
}
```

Success `200`:

```json
{
   "success": true
}
```

Statuses: `200` deleted, `400` invalid input, `404` spot missing, `409` occupied spot.

### Core operations

#### `POST /api/tickets/checkin`

Atomically validates the plate, finds a matching AVAILABLE spot, claims it, and creates an ACTIVE ticket with the current entry timestamp.

Request:

```json
{
   "plate": "MH-01-AB-1234",
   "vehicleType": "EV",
   "spotId": "optional-specific-available-spot-uuid"
}
```

Success `201`:

```json
{
   "spot": {
      "id": "uuid",
      "number": "EV-1",
      "floor": 1,
      "type": "EV",
      "status": "OCCUPIED"
   },
   "ticket": {
      "id": "uuid",
      "plate": "MH-01-AB-1234",
      "entryTime": "2026-09-17T12:00:00.000Z",
      "status": "ACTIVE",
      "spotId": "uuid"
   }
}
```

Statuses: `201` created, `400` invalid JSON/plate/type, `409` duplicate active plate, no matching spot, or transaction conflict.

#### `POST /api/tickets/checkout`

Finds an ACTIVE ticket using a plate, ticket ID, or spot number; loads the assigned spot's RateCard; calculates the fee; completes the ticket; and releases the spot in a transaction.

Request options:

```json
{ "plate": "MH-01-AB-1234" }
```

```json
{ "ticketId": "ticket-uuid" }
```

```json
{ "spotNumber": "EV-1" }
```

Success `200`:

```json
{
   "ticket": {
      "id": "uuid",
      "plate": "MH-01-AB-1234",
      "entryTime": "2026-09-17T12:00:00.000Z",
      "exitTime": "2026-09-17T13:20:00.000Z",
      "fee": 15,
      "status": "COMPLETED",
      "spotId": "uuid"
   },
   "spot": {
      "number": "EV-1",
      "status": "AVAILABLE"
   },
   "fee": {
      "totalParkedMinutes": 80,
      "billedHours": 2,
      "completeDays": 0,
      "remainingHours": 2,
      "totalFee": 15,
      "itemized": {
         "baseHourFee": 10,
         "additionalHoursFee": 5,
         "dailyCapFee": 0
      }
   }
}
```

Statuses: `200` completed, `400` invalid identifier, `404` no ACTIVE ticket, `500` transaction failure.

#### `GET /api/tickets`

Returns a paginated ticket audit log including the assigned spot.

Query parameters:

| Parameter | Default | Description |
|---|---:|---|
| `plate` | none | Case-insensitive partial plate filter after normalization |
| `sortBy` | `entryTime` | Currently supported value is `entryTime` |
| `order` | `desc` | `asc` or `desc` |
| `page` | `1` | One-based page number |
| `limit` | `10` | Positive page size, capped at 100 |

Example:

```text
GET /api/tickets?plate=MH01&sortBy=entryTime&order=desc&page=1&limit=10
```

Success `200`:

```json
{
   "tickets": [
      {
         "id": "uuid",
         "plate": "MH-01-AB-1234",
         "entryTime": "2026-09-17T12:00:00.000Z",
         "exitTime": null,
         "fee": null,
         "status": "ACTIVE",
         "spot": {
            "number": "EV-1",
            "type": "EV"
         }
      }
   ],
   "total": 1,
   "pages": 1
}
```

Statuses: `200` success, `400` unsupported sort/order.

> Compatibility note: the current handler uses `plate`, not `search`, and only permits `sortBy=entryTime`. `search=plate` and `sortBy=fee` should be added before relying on those query names in an external integration.

### Level deliverables

#### Level 1: `POST /api/rates/import`

Accepts one rate object or an array of messy rate objects.

Request:

```json
[
   {
      "type": "  e.v.  ",
      "firstHourRate": "Rs.12.50 / 1st hr",
      "additionalHourRate": "USD 6.00 / extra hr",
      "dailyCap": "Day Cap: Rs.50.00"
   }
]
```

Success `200`:

```json
{
   "success": true,
   "rates": [
      {
         "id": "uuid",
         "spotType": "EV",
         "firstHourRate": 12.5,
         "additionalHourRate": 6,
         "dailyCap": 50,
         "updatedAt": "2026-09-17T12:00:00.000Z"
      }
   ]
}
```

Statuses: `200` upserted, `400` malformed input or missing numeric values.

#### Level 2: `POST /api/clock`

The built application exposes the clock handler at `/api/clock`.

Request:

```json
{
   "currentTime": "2026-09-18T12:00:00.000Z"
}
```

If `currentTime` is omitted, the server clock is used. Tickets parked strictly longer than 24 hours are charged using the spot type's RateCard or default rates, marked COMPLETED, assigned `closeReason: "AUTO_24H"`, and their spots are made AVAILABLE.

Success `200`:

```json
{
   "success": true,
   "simulatedTime": "2026-09-18T12:00:00.000Z",
   "autoClosedCount": 1,
   "closedTickets": [
      {
         "ticketId": "uuid",
         "plate": "MH-01-AB-1234",
         "billedHours": 26,
         "totalFee": 60
      }
   ]
}
```

Statuses: `200` processed, `400`/`500` invalid timestamp or processing failure.

#### Level 3: `POST /api/tickets/transfer`

Transfers an active session to a corrected plate while preserving `spotId` and `entryTime`.

Request:

```json
{
   "currentPlate": "ABC-123",
   "newPlate": "XYZ-999"
}
```

Success `200`:

```json
{
   "success": true,
   "message": "Session transferred from ABC-123 to XYZ-999.",
   "ticket": {
      "id": "uuid",
      "plate": "XYZ-999",
      "previousPlate": "ABC-123",
      "spotNumber": "S-1",
      "spotType": "STANDARD",
      "entryTime": "2026-09-17T12:00:00.000Z",
      "status": "ACTIVE"
   }
}
```

Statuses: `200` transferred, `400` invalid plates, `404` source not active, `409` destination already active.

### Operational correction endpoints

#### `POST /api/tickets/force-close`

Closes an ACTIVE ticket when a car leaves without checkout or an attendant must correct state.

Request:

```json
{
   "ticketId": "ticket-uuid",
   "reason": "TAILGATE",
   "currentTime": "optional ISO timestamp"
}
```

The reason is persisted in `Ticket.closeReason`. The operation calculates the fee, completes the ticket, and releases its spot transactionally. Statuses: `200`, `400`, `404`.

#### `POST /api/tickets/reassign-spot`

Moves an ACTIVE ticket to a different AVAILABLE spot of the same type. This handles a driver who parked in a different compatible bay.

Request:

```json
{
   "ticketId": "ticket-uuid",
   "targetSpotId": "spot-uuid"
}
```

The original `entryTime` is preserved. The target spot is claimed and the old spot released in one transaction. Statuses: `200`, `400`, `404`, `409`.

## 4. Pricing & Fee Engine Rules

The fee engine accepts a rate card:

```ts
type RateConfig = {
   firstHourRate: number;
   additionalHourRate: number;
   dailyCap: number;
};
```

### Billable hours

For a valid non-negative duration:

```text
billedHours = max(1, Math.ceil(durationInMilliseconds / 3,600,000))
```

This means a 15-minute stay is one billed hour under the current shipped policy.

### Tiered pricing

- Tier 1: `firstHourRate` for the first billed hour.
- Tier 2: `additionalHourRate` for every billed hour after the first.
- The residual hourly portion is capped at `dailyCap`.

### Multi-day stays

```text
completeDays = floor(billedHours / 24)
remainingHours = billedHours % 24
dailyFee = completeDays * dailyCap
remainingFee = min(firstHourRate + (remainingHours - 1) * additionalHourRate, dailyCap)
totalFee = dailyFee + remainingFee
```

With default rates of Rs.10, Rs.5, and Rs.45:

```text
26 hours = Rs.45 + (Rs.10 + Rs.5) = Rs.60
```

### Grace-period policy

The fee function accepts an explicit `gracePeriodMinutes` argument for configurable garage policy. The current default is `0`, because the final business rule requires a minimum one-hour charge. To intentionally enable a free grace period for a particular call, pass `15` explicitly; a duration less than or equal to that value returns zero.

The engine rejects invalid dates and negative durations rather than generating a negative or `NaN` fee.

## 5. Troubleshooting & Debugging Guide

### SQLite concurrency and lock contention

Prisma transactions protect logical state, but SQLite still has a single-writer model. Keep transactions short and avoid network calls inside them. The check-in and checkout transactions only perform database reads and writes.

For local debugging:

```bash
npx prisma validate
npx prisma generate
npx prisma db push
npx prisma studio
```

SQLite's write-ahead log mode can reduce reader/writer blocking for a local multi-request workload. If the `sqlite3` CLI is available, enable it for the development database:

```bash
sqlite3 prisma/dev.db 'PRAGMA journal_mode=WAL;'
```

WAL does not turn SQLite into a multi-writer database. Transactions prevent application-level double allocation; WAL improves read/write coexistence, while short transactions and a production PostgreSQL deployment remain the correct answer for sustained high-throughput writes.

If multiple development servers are running, stop duplicate Next processes before retrying:

```bash
ps -ef | grep '[n]ext dev'
kill <PID>
```

For a larger multi-attendant deployment, move from SQLite to PostgreSQL. SQLite is appropriate for this zero-config prototype but is not the ideal high-write production database.

### Connection leakage during hot reload

`lib/prisma.ts` stores one Prisma Client on `globalThis` outside production:

```ts
const globalForPrisma = globalThis as unknown as {
   prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
   globalForPrisma.prisma = prisma;
}
```

This prevents every Next.js hot reload from creating another client and competing for SQLite connections.

### Environment and CLI fixes

If `tsx` is missing:

```bash
npm install
npm install --save-dev tsx
npx tsx prisma/seed.ts
```

If the Prisma CLI reports a broken or stale configuration module:

```bash
find . -maxdepth 2 -name 'prisma.config.*' -print
npx prisma validate
npx prisma generate
npx prisma db push
```

During this prototype, the schema datasource and the Prisma seed command in `package.json` are the authoritative configuration. Prisma 6 also warns that `package.json#prisma` will be removed in Prisma 7; migrate to `prisma.config.ts` before upgrading Prisma.

If the Next app appears to ignore a schema change, stop the server, clear the generated cache, regenerate Prisma, and restart:

```bash
kill <NEXT_PID>
rm -rf parking-app/.next
npx prisma generate
npm --prefix parking-app run dev
```

### Database reset procedure

This destroys local data, recreates the schema, and reseeds the demonstration garage:

```bash
rm -f prisma/dev.db prisma/dev.db-journal
npx prisma generate
npx prisma db push
npx tsx prisma/seed.ts
```

If SQLite reports a lock, stop all Next.js/Prisma processes first and rerun the commands.

### Useful endpoint checks

```bash
curl -sS http://localhost:3000/api/settings
curl -sS http://localhost:3000/api/spots
curl -sS 'http://localhost:3000/api/tickets?page=1&limit=10&sortBy=entryTime&order=desc'
```

Check-in and checkout smoke test:

```bash
curl -sS -X POST http://localhost:3000/api/tickets/checkin \
   -H 'Content-Type: application/json' \
   -d '{"plate":"README-TEST-1","vehicleType":"STANDARD"}'

curl -sS -X POST http://localhost:3000/api/tickets/checkout \
   -H 'Content-Type: application/json' \
   -d '{"plate":"README-TEST-1"}'
```

## Production Readiness Notes

Before deployment to a real garage:

1. Add signed cookie or bearer-token sessions and role-based authorization for settings, rate imports, force-close, and capacity changes.
2. Move from SQLite to PostgreSQL for high concurrent write volume.
3. Use Prisma migrations instead of `db push` for controlled production schema changes.
4. Add ANPR, barrier, or bay-sensor events to reconcile physical occupancy with database state.
5. Add an audit-log model for manual overrides, spot reassignment, rate changes, and lost-ticket verification.
6. Add automated tests for concurrent check-ins, transaction retries, stale sessions, malformed imports, and timezone boundaries.
7. Move the default attendant password into a deployment secret and rotate it immediately.
# Parking-Garage-App
# OmniPark — Smart Multi-Level Garage Management System

A robust, full-stack parking garage operations platform built with Next.js (App Router), Prisma ORM, and SQLite. Designed for high-throughput municipal and commercial parking facilities to automate vehicle check-ins, eliminate spot collisions, sanitize dynamic rate schedules, and ensure mathematically accurate tiered billing with daily caps.

---

## 1. Core Architecture & Feature Matrix

- **Dynamic Garage Capacity:** Operates across any arbitrary garage layout (Compact, Standard, and EV charging bays) without hardcoded spot limitations.
- **Race Condition Prevention:** Uses atomic Prisma database transactions (`prisma.$transaction`) to guarantee zero double-parking under simultaneous check-in attempts.
- **EV Spot Protection:** Strict bay validation ensuring Electric Vehicles are exclusively routed to EV-equipped charging slots.
- **Tiered Dynamic Pricing Engine:** Computes fees dynamically per spot type using tiered logic (First Hour Base, Subsequent Hourly Rate, 24-hour Rolling Cap, and Part-Hour Ceil rounding) with a 15-minute free grace period.
- **Messy Data Sanitization (Level 1 — T4):** Ingests malformed rate card data (currency symbols, erratic spacing, casing inconsistencies) and standardizes it into structured rate cards.
- **Automated Nightly Reconciliation (Level 2 — T2):** Time-simulation endpoint (`POST /clock`) to auto-close and settle sessions exceeding 24 continuous hours.
- **Valet Session Hand-off (Level 3 — T6):** Seamlessly transfers active parking sessions to new license plates while preserving entry timestamps and allocated spots.
- **Attendant Dashboard & Visual Grid:** Interactive "BookMyShow"-style floor layout, real-time EV spot availability counter, live search by license plate, sortable/paginated audit logs, and printable thermal receipts.

---

## 2. Tech Stack

- **Framework:** Next.js 14+ (App Router, Server Actions & REST API Route Handlers)
- **Database & ORM:** SQLite with Prisma ORM (zero-config, ACID-compliant local persistence)
- **Styling:** Tailwind CSS
- **Runtime & Tooling:** TypeScript, Node.js, `tsx`

---

## 3. Getting Started & Setup

### Prerequisites
- Node.js 18.x or higher
- npm 9.x or higher

### Installation & Initialization

1. **Clone the repository and install dependencies:**
   ```bash
   git clone <YOUR_REPOSITORY_URL>
   cd Parking-Garage-App
   npm install