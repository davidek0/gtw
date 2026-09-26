# Backend database layer

This package uses [Drizzle ORM](https://orm.drizzle.team/) with Supabase Postgres.
The TypeScript schema is the source of truth and SQL migrations are committed in
`drizzle/` so database upgrades are repeatable.

## Setup

1. Copy the two connection strings from the Supabase dashboard into `.env`.
2. Install dependencies with `npm install`.
3. Apply the committed migrations with `npm run db:migrate`.

Use a pooled connection string for `DATABASE_URL` when the backend runs in a
serverless environment. Use the direct connection string for `DIRECT_URL` so
migrations run in a single database session. If direct IPv6 connectivity is not
available, Supabase's session pooler connection can be used for `DIRECT_URL`.

## Database workflow

Edit `src/db/schema.ts`, then generate and review a migration:

```sh
npm run db:generate -- --name=describe_the_change
npm run db:check
```

Apply all migrations that have not run yet:

```sh
npm run db:migrate
```

Drizzle records applied migrations in the database, so running the migration
command again is safe. Do not use `drizzle-kit push` for deployed environments;
generate and commit migrations instead.

## Using the data layer

The exported `db` object can be used for typed Drizzle queries. The
`items.repository.ts` file is a complete insert/select/update/delete example:

```ts
import { createItem, deleteItem, listItems, updateItem } from "./src/db/index.js";

const item = await createItem({ name: "First item", description: null });
await updateItem(item.id, { description: "Updated" });
const items = await listItems();
await deleteItem(item.id);
```

Close the database pool during one-off scripts or graceful shutdowns with
`closeDatabase()`.

## Garmin Connect hackathon sync

The active Garmin integration uses the unofficial
[`python-garminconnect`](https://github.com/cyberjunky/python-garminconnect)
client for one consenting Garmin account. It does not require Garmin developer
API keys. The watch must first sync to Garmin Connect through the Garmin Connect
phone app or the watch's configured Wi-Fi connection.

The flow is:

```text
watch -> Garmin Connect phone app/Wi-Fi -> Garmin cloud -> Python poller
      -> protected TypeScript ingest endpoint -> Supabase Postgres
```

### 1. Configure the backend

Copy `.env.example` to `.env` and fill in:

```text
DATABASE_URL=          Supabase pooled Postgres connection
DIRECT_URL=            Supabase direct/session-pooler connection for migrations
ADMIN_API_TOKEN=       any long random secret
GARMIN_EMAIL=          the consenting person's Garmin login email
GARMIN_SUBJECT_ID=     your internal name for that person, for example person-1
```

Generate `ADMIN_API_TOKEN` with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Do not put the Garmin password or MFA code in `.env`.

### 2. Install and migrate

The Garmin scripts use `uv`, which is already installed on this machine. It
automatically supplies Python 3.12 and the pinned Garmin package.

```powershell
cd backend
npm install
npm run db:migrate
```

For a machine without `uv`, create a Python 3.12 virtual environment and install
`scripts/requirements-garmin.txt`, then run the Python script directly.

### 3. Sign in once (this is where credentials and MFA are entered)

Run this in a terminal opened in the `backend` directory:

```powershell
npm run garmin:login
```

The script asks for the Garmin password using a hidden prompt, then asks for the
MFA code if Garmin requires it. Refreshable tokens are saved under
`backend/.garmin-tokens/garmin_tokens.json`. That directory is ignored by Git;
treat it like a password. The plaintext password is not stored.

### 4. Start the backend and sync

Terminal 1:

```powershell
npm run dev
```

After the watch has synced with Garmin Connect, use Terminal 2:

```powershell
npm run garmin:sync
```

To keep checking Garmin at the configured interval:

```powershell
npm run garmin:poll
```

The poller fetches daily summary, heart rate, sleep, stress, Body Battery, HRV,
SpO2, and respiration when available. Unsupported metrics are skipped. Repeated
runs update the same person/date/metric row instead of creating duplicates.

Read the saved data through the protected endpoint:

```http
GET /api/garmin-connect/person-1/health?type=sleep&limit=100
Authorization: Bearer <ADMIN_API_TOKEN>
```

This is an unofficial integration intended for the hackathon. Garmin may change
or rate-limit its private endpoints, so keep polling conservative and migrate to
the official Health API before treating it as a production integration.

## Live Bluetooth heart-rate test

The cloud sync above is not real time. For compatible watches, the live listener
connects directly to Garmin's standard Bluetooth Heart Rate service, prints each
BPM reading, and saves timestamped samples in
`garmin_live_heart_rate_samples`.

On the watch, enable **Broadcast Heart Rate**. It is commonly under:

```text
Settings -> Health & Wellness -> Wrist Heart Rate -> Broadcast Heart Rate
```

Keep the broadcast screen running, enable Bluetooth on the computer, and scan:

```powershell
cd C:\Users\emilg\repos\gtw\backend
npm run garmin:live:scan
```

If a `HEART RATE` device is found, start the TypeScript backend in one terminal:

```powershell
npm run dev
```

Then run the guided test in another terminal:

```powershell
npm run garmin:live:test
```

You can pass a scanned Bluetooth address directly as a positional argument:

```powershell
npm run garmin:live:test -- 14:13:0B:17:A0:32
```

The default test records 20 seconds at rest, announces when to perform 45
seconds of jumping jacks, then records 30 seconds of recovery. At the end it
prints the resting median, exercise peak, and BPM increase. Readings are uploaded
in small batches using `ADMIN_API_TOKEN`.

If several heart-rate devices are nearby, copy the desired address shown by the
scan into `GARMIN_BLE_ADDRESS` in `.env`. Test timings can also be overridden:

```powershell
npm run garmin:live:test -- --baseline 30 --exercise 60 --recovery 60
```

This test is a software demonstration, not medical monitoring. Optical wrist
heart rate can lag during rapid movement and can produce missing or inaccurate
values.
