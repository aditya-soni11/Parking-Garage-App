# OmniPark Engineering Log

**Build window:** approximately 2.5 hours

**Project:** OmniPark parking garage operations console

This log records the implementation decisions, debugging checkpoints, and validation work completed while building the first usable version of OmniPark. The project was deliberately built around the attendant's day: check a vehicle in, assign a legal spot, find the vehicle later, calculate the fee consistently, and release the spot without double-booking it.

## 1. Architectural Strategy & Design Trade-offs

### Framework choice

We selected Next.js with the App Router, Prisma, and SQLite because the first version needed to be both a usable operator interface and a working backend in one Codespaces workspace.

- **Next.js App Router** gives us the dashboard and server route handlers in one repository. The operator UI can call local `/api/*` endpoints without introducing a second service or CORS configuration.
- **Route handlers** execute close to the application server and avoid an extra network hop to a separately deployed API during local development. This is effectively zero-latency relative to a separate local backend process.
- **Prisma** gives the application typed database access, relational queries, and transaction boundaries without handwritten SQLite SQL for every workflow.
- **SQLite** was chosen for the evaluation and prototype phase because it is file-based, persistent, zero-configuration, and immediately usable inside GitHub Codespaces. `prisma/dev.db` is enough to run the system without provisioning a database server.

The repository contains shared server modules at the workspace root and a runnable Next application under `parking-app/`. Thin route entrypoints in `parking-app/app/api` re-export the shared handlers so the deployed Next app and the shared implementation do not diverge.

### Dynamic configuration: "Any Garage, Not One"

The original seed data contains 15 spots, but that is demonstration data rather than the product's operating model. Hardcoding a single 15-spot floor plan would make the system unusable for a different garage.

The relational model separates operational concepts:

```prisma
model Spot {
	id     String @id @default(uuid())
	number String @unique
	floor  Int    @default(1)
	type   String
	status String @default("AVAILABLE")
}

model RateCard {
	spotType           String @unique
	firstHourRate      Float
	additionalHourRate Float
	dailyCap           Float
}

model Ticket {
	plate     String
	entryTime DateTime @default(now())
	spotId    String
	status    String @default("ACTIVE")
}
```

`GarageSettings` stores the garage identity, address, tax/GST identifier, and floor count. The spot API supports bulk creation by floor and type, so capacity can be changed without changing application code. `RateCard` makes pricing configurable per spot type rather than burying prices in the checkout route.

### State integrity and concurrency

Transactions were mandatory for check-in and checkout. A read followed by a later write would create a race window:

1. Attendant A reads spot `S-01` as available.
2. Attendant B reads the same spot as available.
3. Both create tickets against the same spot.

The check-in flow therefore performs active-ticket validation, spot selection, conditional spot claiming, and ticket creation inside `prisma.$transaction`. The conditional `updateMany` must affect exactly one row before the ticket is created.

Checkout similarly updates the ACTIVE ticket and releases its spot within one transaction. If either operation fails, Prisma rolls the whole operation back instead of leaving an occupied ticket with an available spot or the reverse.

## 2. Fee Calculation Engine & Edge Cases

The fee engine lives in [lib/fee.ts](lib/fee.ts). Its core inputs are entry time, exit time, and an optional dynamic rate configuration:

```ts
calculateParkingFee(entryTime, exitTime, {
	firstHourRate: 10,
	additionalHourRate: 5,
	dailyCap: 45,
});
```

### Mathematical model

For a non-grace-period stay:

1. Calculate elapsed milliseconds and convert to hours.
2. Round partial hours upward with `Math.ceil`.
3. Enforce a minimum of one billed hour.
4. Split billed hours into complete 24-hour blocks and a remainder.
5. Charge `completeDays * dailyCap` for complete blocks.
6. Apply the first-hour rate plus discounted additional-hour rates to the remainder, capped at the daily cap.

Conceptually:

```text
billedHours = max(1, ceil(elapsedHours))
completeDays = floor(billedHours / 24)
remainingHours = billedHours % 24
dailyFee = completeDays * dailyCap
remainingFee = min(firstHourRate + (remainingHours - 1) * additionalHourRate, dailyCap)
totalFee = dailyFee + remainingFee
```

With the default rates, a 26-hour stay is:

```text
1 * Rs.45 daily cap + 2 remaining hours
Rs.45 + Rs.10 + Rs.5 = Rs.60
```

### Operational reality checks

An earlier implementation introduced a 15-minute free grace period to reduce disputes when a vehicle entered and immediately could not find a spot. That behavior was tested, but it conflicted with the final product rule that every stay should be billed for at least one hour. The shipped configuration is now:

```ts
const DEFAULT_GRACE_PERIOD_MINUTES = 0;
```

The function still accepts an explicit grace-period argument so a garage can adopt a different policy later. With the shipped default, a 15-minute stay is billed as one hour at the first-hour rate.

The engine also rejects invalid dates and negative durations. This protects against malformed input, clock drift, and time-order errors caused by a client clock or an unexpected timestamp conversion:

```ts
if (!Number.isFinite(entryTime.getTime()) || !Number.isFinite(exitTime.getTime())) {
	throw new RangeError("Entry and exit times must be valid dates");
}

if (exitTime.getTime() < entryTime.getTime()) {
	throw new RangeError("Exit time cannot be before entry time");
}
```

The returned breakdown includes parked minutes, billed hours, daily blocks, and itemized base/additional/daily-cap amounts for the printable receipt.

## 3. Level Progression & Technical Mechanics

### Level 1 - T4: messy rate-card sanitization

`POST /api/rates/import` accepts a single object or an array. The import path deliberately treats external rate data as untrusted and normalizes it before writing `RateCard` rows.

Examples accepted by the importer include:

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

The parser:

- Extracts the first numeric amount with a regular expression.
- Removes currency symbols, commas, labels, and stray spacing.
- Normalizes type text by uppercasing and removing punctuation.
- Maps electric-vehicle variants to `EV`.
- Rejects missing or invalid values instead of silently saving zero rates.
- Uses `upsert` on the unique `spotType`, making repeated imports idempotent.

### Level 2 - T2: automated nightly auto-close

`POST /api/clock` accepts an ISO `currentTime`, which makes time advancement deterministic during grading and testing:

```json
{ "currentTime": "2026-09-18T12:00:00.000Z" }
```

The route loads all ACTIVE tickets with their assigned spots, calculates elapsed hours against the supplied time, and selects only tickets with strictly more than 24 elapsed hours. Each qualifying ticket is processed transactionally:

1. Load the `RateCard` for the assigned spot type.
2. Fall back to the default rate configuration if no card exists.
3. Calculate and save the fee, exit timestamp, and `AUTO_24H` close reason.
4. Mark the ticket COMPLETED.
5. Return the assigned spot to AVAILABLE.

The spot release is intentionally idempotent because a stale database record can contain an ACTIVE ticket whose spot was already marked available. One inconsistent record should not abort the entire expiration batch.

### Level 3 - T6: valet plate hand-off

`POST /api/tickets/transfer` supports a valet or attendant correcting the vehicle identifier while the session is still active:

```json
{
	"currentPlate": "ABC-123",
	"newPlate": "XYZ-999"
}
```

The route normalizes and validates both plates, requires the source ticket to be ACTIVE, rejects a destination plate that already has an ACTIVE session, and performs the conflict check plus update inside a transaction. Its update payload changes only `plate`, so `spotId` and `entryTime` remain unchanged.

## 4. Testing Procedures & Edge Cases Validated

### Check-in collision test

For an EV garage with one remaining available EV spot, send two check-ins concurrently:

```bash
curl -sS -X POST http://localhost:3000/api/tickets/checkin \
	-H 'Content-Type: application/json' \
	-d '{"plate":"EV-TEST-1","vehicleType":"EV"}' &

curl -sS -X POST http://localhost:3000/api/tickets/checkin \
	-H 'Content-Type: application/json' \
	-d '{"plate":"EV-TEST-2","vehicleType":"EV"}' &

wait
```

Expected behavior: one request receives the final spot and the other receives `409 No available spot`. The conditional claim and transaction prevent both tickets from receiving the same spot.

### Short-stay test

During the earlier grace-period phase, the test was:

```bash
node -e 'console.log("entry=10:00, exit=10:15, expected fee=Rs.0 during grace-period phase")'
```

That test confirmed the grace-period branch. It is no longer the final billing policy. The current check is:

```bash
npx tsx -e 'import { calculateParkingFee } from "./lib/fee.ts"; const e = new Date("2026-01-01T00:00:00Z"); const x = new Date(e.getTime() + 15 * 60 * 1000); console.log(calculateParkingFee(e, x).totalFee);'
```

Expected final result: `10`, because a 15-minute stay is rounded to one billed hour and the default grace period is zero.

### Multi-day stay test

```bash
npx tsx -e 'import { calculateParkingFee } from "./lib/fee.ts"; const e = new Date("2026-01-01T00:00:00Z"); const x = new Date(e.getTime() + 26 * 60 * 60 * 1000); console.log(calculateParkingFee(e, x));'
```

Expected values with default rates:

```text
billedHours: 26
completeDays: 1
remainingHours: 2
totalFee: 60
```

### Time-warp simulation

```bash
curl -sS -X POST http://localhost:3000/api/tickets/checkin \
	-H 'Content-Type: application/json' \
	-d '{"plate":"CLOCK-26","vehicleType":"STANDARD"}'

curl -sS -X POST http://localhost:3000/api/clock \
	-H 'Content-Type: application/json' \
	-d "{\"currentTime\":\"$(date -u -d '+26 hours' '+%Y-%m-%dT%H:%M:%SZ')\"}"
```

The route returns `autoClosedCount: 1`, the ticket's billed hours, the calculated total, and the `AUTO_24H` close reason. If the generated timestamp is more than 26 hours and a few seconds after entry, `Math.ceil` can correctly produce 27 billed hours.

### Valet hand-off validation

```bash
curl -sS -X POST http://localhost:3000/api/tickets/transfer \
	-H 'Content-Type: application/json' \
	-d '{"currentPlate":"ABC-123","newPlate":"XYZ-999"}'
```

Before and after the call, compare the ticket's `spotId` and `entryTime`. The response should show the same spot number and entry timestamp, with only the plate changed.

### Build and static checks

The final validation loop was:

```bash
npx prisma db push
npx prisma generate
npm --prefix parking-app run lint
npm --prefix parking-app run build
git diff --check -- prisma lib app/api parking-app/app
```

The production build confirmed the route table included authentication, spots, rates, settings, clock, ticket listing, check-in, checkout, transfer, force-close, and reassignment routes.

## 5. Issues Encountered & How We Fixed Them

### Prisma init CLI breaking change

The expected command using a datasource-provider flag was not available in the installed Prisma CLI. Rather than depend on a version-specific initializer, we created `prisma/schema.prisma` directly with the SQLite datasource, Prisma Client generator, and the application models. `npx prisma db push` then created and synchronized the local database.

### Bad config module error

A stale or incompatible Prisma configuration caused startup and CLI confusion. The reliable recovery was to remove the stale configuration path, keep the datasource declaration in the schema during the prototype phase, and run:

```bash
npx prisma db push
npx prisma generate
```

Prisma later warned that `package.json#prisma` is deprecated for Prisma 7, which is a follow-up migration item rather than a runtime blocker for this build.

### Hot-reload connection exhaustion

Creating a new Prisma Client on every module reload can exhaust connections or create SQLite locking pressure. The shared client uses the development global singleton pattern:

```ts
const globalForPrisma = globalThis as unknown as {
	prisma: PrismaClient | undefined;
};

export const prisma =
	globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
	globalForPrisma.prisma = prisma;
}
```

This keeps hot reloads from constructing an unbounded set of clients.

### Spot double-allocation under rapid clicks

The initial check-in design had a read-then-write gap: it selected an available spot and created a ticket later. Rapid requests could both observe the same spot. The fix bundled duplicate-active-ticket detection, spot discovery, conditional spot claiming, and ticket creation in one `prisma.$transaction`.

The same principle was applied to checkout, transfer, reassignment, and force-close. Each workflow checks its expected current state at write time and rolls back if another operator has already changed it.

### Nested Next application and stale generated runtime

The repository has shared root handlers and the runnable Next app under `parking-app/`. Missing nested re-export files caused routes to compile but not be served. Adding thin nested route exports fixed route discovery. During development, a long-running server also held stale Prisma metadata after schema changes; restarting the server and clearing `.next` loaded the regenerated client.

### Scope boundary: physical truth

Software can provide reconciliation, force-close, reassignment, audit reasons, and warnings. It cannot independently know that a car tailgated through a gate or occupied the wrong physical bay. That requires an ANPR camera, barrier event, or bay sensor integration. The architecture leaves those inputs available for a later event-ingestion layer rather than pretending the database state is physical truth.
