# OmniPark Conversation and Engineering Log

This file records the substantive requests, implementation decisions, debugging events, validations, and known limitations from the OmniPark build conversation.

Date context: 2026-09-17

## 1. Initial Prisma Persistence and Seed

### User request

Build a Next.js App Router parking garage application using Prisma and SQLite. The first requested work was:

1. Add a hot-reload-safe singleton Prisma Client in `lib/prisma.ts`.
2. Add `prisma/seed.ts` with:
	 - One attendant user: `attendant@garage.com` / `admin123`.
	 - Fifteen available spots.
	 - Five EV spots (`EV-1` through `EV-5`).
	 - Five compact spots (`C-1` through `C-5`).
	 - Five standard spots (`S-1` through `S-5`).
3. Add the package configuration and seed command.

### Initial repository findings

- `lib/prisma.ts` was empty.
- `prisma/seed.ts` was empty.
- `prisma/schema.prisma` already contained `User`, `Spot`, and `Ticket` models.
- `Spot.type`, `Spot.status`, and `Ticket.status` were string fields rather than Prisma enums.
- The root `package.json` contained Prisma dependencies but no TypeScript seed runner.
- The Next.js app lived under `parking-app/`, separate from the root Prisma files.

### Implementation

The singleton pattern was added:

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
	prisma: PrismaClient | undefined;
};

export const prisma =
	globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
	globalForPrisma.prisma = prisma;
}
```

The seed script used idempotent `upsert` calls so it could be run repeatedly without creating duplicate users or spots. The root package received:

```json
{
	"devDependencies": {
		"@prisma/client": "^6.19.3",
		"prisma": "^6.19.3",
		"tsx": "^4.19.2"
	},
	"prisma": {
		"seed": "tsx prisma/seed.ts"
	}
}
```

### Validation

The following commands passed:

```bash
npm install
npx prisma generate
npx prisma db push
npx prisma db seed
```

The seeded data was queried and confirmed:

```json
{
	"users": 1,
	"spotCount": 15,
	"available": true,
	"counts": {
		"EV": 5,
		"COMPACT": 5,
		"STANDARD": 5
	}
}
```

## 2. Fee Engine

### User request

Create `calculateParkingFee(entryTime, exitTime)` in `lib/fee.ts` with:

- Rs.10 for the first hour.
- Rs.5 for each additional hour.
- Rs.45 daily cap per 24-hour block.
- Partial hours rounded up.
- A breakdown type for the returned values.

### Implementation

The fee engine initially returned duration, billed hours, complete days, remaining hours, daily fee, remaining fee, and total fee. It rejected exit times before entry.

The calculation became dynamic through `RateConfig`:

```ts
export interface RateConfig {
	firstHourRate: number;
	additionalHourRate: number;
	dailyCap: number;
}
```

The core formula became:

```text
billedHours = max(1, ceil(durationInHours))
completeDays = floor(billedHours / 24)
remainingHours = billedHours % 24
dailyFee = completeDays * dailyCap
remainingFee = min(firstHourRate + (remainingHours - 1) * additionalHourRate, dailyCap)
totalFee = dailyFee + remainingFee
```

### Testing issue

The first fee assertion used a JavaScript `Date` helper incorrectly. Passing `24` as the hour constructor argument created a time 24 minutes later rather than 24 hours later. The helper was corrected to add milliseconds explicitly.

Corrected boundary tests passed for:

- Zero-duration minimum billing.
- 65-minute partial-hour rounding.
- 24-hour daily cap.
- 25-hour stays.
- 48-hour stays.
- Exit before entry rejection.

## 3. Security and Vulnerability Review

### User request

Review the project against the parking garage storyline and identify vulnerabilities.

### Findings

The review identified:

- Plaintext seed credentials and plaintext password storage in the original implementation.
- SQLite database artifacts not initially ignored by `.gitignore`.
- No database-level enforcement for one active ticket per spot.
- Spot type and status values represented as unconstrained strings.
- Invalid `Date` objects could produce `NaN` fee results.
- Three high-severity development-toolchain advisories through Prisma CLI's transitive `deepmerge-ts` dependency.
- No runtime dependency advisories in the Next app or production-only dependency tree.

### Security fixes

`bcryptjs` was added. The seed now hashes `admin123`, and login uses `bcrypt.compare`. A register endpoint was added with an eight-character minimum password rule.

SQLite files were added to `.gitignore`:

```gitignore
prisma/*.db
prisma/*.db-journal
```

The dependency audit result remained:

- Root development tree: three high-severity Prisma CLI transitive advisories.
- `parking-app`: zero vulnerabilities.
- Runtime-only audit: zero vulnerabilities.

The Prisma advisory was not fixed with `npm audit fix --force` because the suggested action involved a Prisma downgrade and breaking change.

## 4. Initial REST API Routes

### User request

Create App Router handlers for:

- `POST /api/auth/login`
- `GET /api/spots`
- `POST /api/tickets/checkin`
- `POST /api/tickets/checkout`
- `GET /api/tickets`

### Implementation

The handlers were first created under root `app/api`. The build revealed that the runnable Next app was under `parking-app/`, so thin re-export files were added under `parking-app/app/api`.

Shared handlers were changed from importing `next/server` to using the standard Web `Response.json()` API. This allowed the root-shared handlers to compile through the nested Next application without resolving `next/server` from the wrong package boundary.

### Check-in behavior

The check-in transaction:

1. Normalizes the license plate.
2. Rejects a plate that already has an ACTIVE ticket.
3. Finds an AVAILABLE spot matching `EV`, `COMPACT`, or `STANDARD`.
4. Conditionally claims that spot.
5. Creates an ACTIVE ticket.

### Checkout behavior

Checkout:

1. Finds the ACTIVE ticket.
2. Includes the assigned spot.
3. Loads a matching `RateCard` by spot type.
4. Falls back to Rs.10/Rs.5/Rs.45.
5. Calculates the fee.
6. Completes the ticket and frees the spot in a transaction.

### Ticket listing

The ticket listing supports partial plate filtering, entry-time sort order, page number, and page size capped at 100.

### Validation

The Next production build eventually reported:

```text
Route (app)
├ ƒ /api/auth/login
├ ƒ /api/auth/register
├ ƒ /api/spots
├ ƒ /api/tickets
├ ƒ /api/tickets/checkin
└ ƒ /api/tickets/checkout
```

## 5. OmniPark Frontend

### User request

Replace the default Next.js starter page with a usable OmniPark frontend containing:

- Landing hero.
- Tiered pricing messaging.
- EV reservation messaging.
- Real-time plate lookup messaging.
- Commercial operator audience.
- Double-parking prevention explanation.
- Three future features.
- Attendant stats.
- Check-in card.
- Checkout card with fee modal.
- Searchable/sortable/paginated parking log.

### Implementation

`parking-app/app/page.tsx` became a client component connected to the REST APIs. It includes:

- Available spot, occupied spot, EV availability, and occupancy-rate cards.
- Check-in form for plate and vehicle type.
- Checkout form and printable receipt modal.
- Live log search and entry-time sort toggle.
- Previous/Next pagination.
- Garage configuration and capacity controls.
- Floor tabs and interactive spot map.
- Maintenance status controls.
- Roadmap section.

The page was later visually refined with:

- Geist typography.
- Operator-console slate workspace background.
- Subtle grid texture.
- Coral, green, and slate status hierarchy.
- Keyboard focus rings.
- Responsive spacing.
- Updated OmniPark metadata.

### UI validation

The following passed repeatedly:

```bash
npm --prefix parking-app run lint
npm --prefix parking-app run build
```

The app was served at `http://localhost:3000` during development when the port was available. When port 3000 was occupied, Next selected another port or reported the existing process.

## 6. Dynamic Garage Configuration

### User request

Expand the application for "any garage, not one" with identity, floor count, custom capacity, maintenance status, and a visual floor map.

### Schema changes

`Spot` received:

- `floor Int @default(1)`.
- `MAINTENANCE` as a supported status convention.

`GarageSettings` was added:

```prisma
model GarageSettings {
	id         String   @id @default("default")
	name       String   @default("OmniPark Garage")
	address    String   @default("")
	taxId      String   @default("")
	floorCount Int      @default(1)
	updatedAt  DateTime @updatedAt
}
```

### New API behavior

- `GET /api/settings`
- `PATCH /api/settings`
- `POST /api/spots` for bulk capacity creation.
- `PATCH /api/spots` for AVAILABLE/MAINTENANCE state changes.
- `DELETE /api/spots` for safe removal of non-occupied spots.

Occupied spots cannot be removed or manually changed to maintenance.

### Floor map

The dashboard map color-codes:

- Available spots.
- Occupied spots.
- EV available spots.
- Maintenance spots.

Clicking an occupied spot shows its active plate and entry timestamp. Clicking an available spot pre-fills the check-in type and can request that specific spot.

## 7. Fee Engine Enhancements

### User request

Add dynamic rate cards, a 15-minute grace-period capability, invalid-date protection, itemized receipt output, and printable checkout receipts.

### Implementation

`ParkingFeeBreakdown` now includes:

- `gracePeriodApplied`.
- `totalParkedMinutes`.
- `billedHours`.
- `completeDays`.
- `dailyFee`.
- `remainingFee`.
- `totalFee`.
- Base-hour, additional-hours, and daily-cap itemization.

The function accepts an explicit `gracePeriodMinutes` argument. During development the default was temporarily set to 15 minutes, then changed to zero when the final policy was clarified: a 15-minute stay must be billed as one hour.

### Receipt

The checkout modal displays:

- Garage name and address.
- Ticket ID.
- Plate.
- Vehicle type.
- Spot number.
- Entry and exit times.
- Parked minutes.
- Billed hours.
- Complete days.
- Itemized fees.
- Final amount.

`window.print()` and print-only CSS were added for physical receipts.

## 8. Level Deliverables

### Level 1: messy rate import

`POST /api/rates/import` was added to normalize inputs such as:

```json
{
	"type": "  e.v.  ",
	"firstHourRate": "Rs.12.50 / 1st hr",
	"additionalHourRate": "USD 6.00 / extra hr",
	"dailyCap": "Day Cap: Rs.50.00"
}
```

The importer:

- Extracts numeric values using regular expressions.
- Normalizes punctuation and casing.
- Maps electric variants to `EV`.
- Rejects missing numeric values rather than silently writing zero.
- Upserts by unique spot type.

### Level 2: automated clock auto-close

`POST /api/clock` accepts an ISO `currentTime` and closes ACTIVE tickets parked strictly more than 24 hours. It loads dynamic rates, calculates the fee, saves `AUTO_24H` as the close reason, completes the ticket, and frees the spot.

Important path correction: the runnable Next app exposes this as `/api/clock`, not `/clock`.

### Level 3: valet hand-off

`POST /api/tickets/transfer` accepts `currentPlate` and `newPlate`, rejects duplicate active destination plates, and changes only the plate. `spotId` and `entryTime` remain unchanged.

## 9. Operational Edge Cases and Fixes

### Ghost car / tailgating

The database cannot observe a physical vehicle leaving without a camera, barrier, or sensor event. Software mitigation was added:

- `POST /api/tickets/force-close`.
- Required close reason such as `TAILGATE` or `MANUAL_OVERRIDE`.
- Persisted `Ticket.closeReason`.
- Transactional fee completion and spot release.
- Automatic `AUTO_24H` closure.

### Wrong physical spot

The database cannot know that a car ignored its assigned bay. A transactional correction endpoint was added:

```text
POST /api/tickets/reassign-spot
```

It requires an AVAILABLE target spot of the same type, claims the target, moves the active ticket, and releases the old spot.

### Lost or unreadable plate

Checkout accepts any of:

- `plate`.
- `ticketId`.
- `spotNumber`.

This means an attendant can find a session even if the original plate was mistyped or unreadable.

## 10. Authentication and Search

### Authentication UI

The dashboard now includes an operator authentication dialog with:

- Sign-in mode.
- Registration mode.
- Password validation.
- Bcrypt-backed API calls.
- Success/error feedback.

The current UI stores the returned session only in client state. A signed cookie or bearer-token session is still required before protecting admin operations in production.

### Search

Ticket search supports both query names:

```text
/api/tickets?plate=ABC
/api/tickets?search=ABC
```

The UI searches by plate or ticket-oriented text and refreshes the paginated ticket log.

## 11. Debugging and Validation History

### Prisma CLI behavior

The Prisma CLI behavior differed from expected initializer documentation. The schema was created manually with a SQLite datasource, then synchronized with:

```bash
npx prisma db push
npx prisma generate
```

### Stale Prisma client during hot reload

After adding `RateCard`, `GarageSettings`, and `Spot.floor`, an already-running Next process loaded stale Prisma metadata. Symptoms included errors such as:

```text
Unknown field `floor` for select statement on model `Spot`.
Cannot read properties of undefined (reading 'upsert')
```

The recovery procedure was:

```bash
kill <NEXT_PID>
rm -rf parking-app/.next
npx prisma generate
npm --prefix parking-app run dev
```

### Checkout transaction issue

A stale runtime initially reported `transaction.rateCard` as undefined. Regenerating Prisma and restarting the development server fixed the runtime client. A separate stale test record also caused `SPOT_RELEASE_FAILED`; the release logic was made idempotent and temporary test records were cleaned.

### React lint issue

React 19 lint rules rejected synchronous state updates from an effect and rejected using `useEffectEvent` from button handlers. The initial dashboard refresh was deferred with `setTimeout`, while user-triggered refreshes remained regular functions.

### Hydration warning

Development logs showed a body attribute mismatch caused by a browser extension adding Grammarly attributes:

```text
data-new-gr-c-s-check-loaded
data-gr-ext-installed
```

This was external browser DOM mutation, not an application render mismatch.

### Validation commands

The final validation sequence used throughout the build was:

```bash
npx prisma validate
npx prisma db push
npx prisma generate
npm --prefix parking-app run lint
npm --prefix parking-app run build
git diff --check
```

Focused runtime checks included:

```bash
curl -sS -X POST http://localhost:3000/api/auth/login \
	-H 'Content-Type: application/json' \
	-d '{"email":"attendant@garage.com","password":"admin123"}'

curl -sS 'http://localhost:3000/api/tickets?search=README&page=1&limit=10'
```

## 12. Current Production Caveats

Before deploying to a real multi-attendant facility:

1. Add signed authentication sessions and role-based authorization.
2. Protect rate import, settings, capacity, force-close, and reassignment operations.
3. Replace SQLite with PostgreSQL for sustained concurrent writes.
4. Replace `db push` with Prisma migrations.
5. Add ANPR, gate, or bay-sensor event ingestion for physical occupancy truth.
6. Add an audit-log model for all manual corrections and operator actions.
7. Add automated concurrency and API integration tests.
8. Rotate the seeded attendant password immediately.
9. Add `sortBy=fee` support if external clients require fee sorting; the current ticket route supports `entryTime` sorting.
