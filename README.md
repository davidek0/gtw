# Pulsefold

A remote ward round for hospital-at-home, built at the Gbg Tech Week x Chalmers
Hackathon (Open Health Track: *How can we build the next generation
hospital-at-home?*).

On a ward, nurses see every patient several times a day. At home, nobody does
between visits, so deterioration is noticed late. Pulsefold closes that gap
without asking elderly patients to use an app:

- **Daily voice check-in.** The patient talks to the AI in Swedish; afterwards
  it writes a short summary for the care team. Speech recognition and speech
  synthesis run locally, so the audio never leaves the machine.
- **Wearable data.** A Garmin watch supplies sleep, steps, resting pulse and HRV
  through Garmin Connect, plus live heart rate over Bluetooth with an acute
  threshold the clinician sets.
- **Clinician view.** A worklist that triages patients, and a patient page with
  the latest check-in summary, trends and live pulse. Missed check-ins are
  flagged.

> This is a hackathon prototype, not a medical device. Most patients are demo
> data; `person-1` is the Garmin-connected demo patient.

## Running the demo

Everything starts with one command from the repository root:

```sh
npm run dev
```

Press `Ctrl+C` to stop all of it. The first run installs missing npm
dependencies and downloads the speech models (KB-Whisper and a Piper voice),
which takes a few minutes.

| Service | Port | What it is |
|---|---|---|
| `frontend` | 8080 | The Pulsefold web app |
| `backend` | 3000 | Garmin ingest and read API on Supabase Postgres |
| `garmin-live` | – | Bluetooth heart-rate monitor that uploads live pulse |
| `garmin-sync` | – | One Garmin Connect sync once the backend is up |
| `llm-proxy` | 4000 | LiteLLM proxy in front of the LLM providers |
| `voice` | 7860 | Browser voice check-in (Pipecat over WebRTC) |

Then open:

- http://localhost:8080/overview — the patient's page with the voice check-in
- http://localhost:8080/worklist — the clinician's patient list
- http://localhost:8080/patient/person-1 — patient details, check-in summary and live pulse

### Requirements

- Node.js 22+ and [uv](https://docs.astral.sh/uv/) (uv provides Python 3.12).
- On Linux: `sudo apt install portaudio19-dev` before the first run.
- An NVIDIA GPU makes speech recognition faster; without one it runs on the CPU.
- Bluetooth, for the live pulse.

### Configuration

Two `.env` files, neither of which is committed:

- **`backend/conversation/.env`**: LLM broker keys for the voice check-in. Copy
  `backend/conversation/.env.example` and fill it in.
- **`backend/.env`**: Garmin backend settings: `DATABASE_URL`, `DIRECT_URL`,
  `ADMIN_API_TOKEN`, `GARMIN_EMAIL`, `GARMIN_SUBJECT_ID` and optionally
  `GARMIN_BLE_ADDRESS`. See [backend/README.md](backend/README.md). Without
  `DATABASE_URL` the Garmin services are skipped with a message and the rest of
  the demo still runs.

For the Garmin data:

1. Sign in to Garmin once. This asks for the password and MFA code and stores
   refreshable tokens in `backend/.garmin-tokens/` (keep that folder private):
   ```sh
   cd backend
   npm run garmin:login
   ```
2. For live pulse, turn on **Broadcast Heart Rate** on the watch (Settings →
   Health & Wellness → Wrist Heart Rate). The monitor keeps retrying until the
   watch is in range.

## How it fits together

```text
Garmin watch ──Bluetooth──> garmin-live ──┐
Garmin Connect ───────────> garmin-sync ──┼──> backend :3000 ──> Supabase Postgres
                                          │
Browser mic/speaker <──WebRTC──> voice :7860 ──> llm-proxy :4000 ──> LLM providers
                                          │
                          frontend :8080 ─┘  patient overview, worklist, patient page
```

The voice server keeps each patient's latest check-in in memory and serves it at
`GET /api/latest-checkins`, which the clinician pages poll. Results are lost when
it restarts. Transcripts are sent to the LLM providers for the summary; audio is
not.

## Repository layout

| Path | Contents |
|---|---|
| [`frontend/`](frontend) | The web app (TanStack Start, React, Tailwind). Connected to Lovable: don't rewrite pushed history ([AGENTS.md](frontend/AGENTS.md)). |
| [`backend/`](backend/README.md) | Garmin integration: Fastify API, Drizzle migrations, Garmin Connect sync and Bluetooth monitor. |
| [`backend/conversation/`](backend/conversation/README.md) | Voice check-in in Python: Pipecat, KB-Whisper, Piper, LiteLLM. Also a structured Swedish check-in with rule-based red flags for the terminal. |
| [`backend/analysis/`](backend/analysis/README.md) | Standalone prototype of alert rules for wearable and check-in data. Not started by `npm run dev`. |
| [`scripts/start-demo.mjs`](scripts/start-demo.mjs) | What `npm run dev` runs. |
| [`docs/`](docs) | Challenge brief, sources and market research. |
| [`deliverables/`](deliverables) | Concept, pitch and prototype material. |
| [`plan.md`](plan.md), [`Conversational_System_implementation_plan.md`](Conversational_System_implementation_plan.md) | Product notes and the voice backend plan. |

## Troubleshooting

- **A port is already in use:** a server from an earlier run is still running.
  Stop it, then run `npm run dev` again.
- **No AI voice:** if the browser blocks audio, click **Enable AI audio** on the
  check-in card.
- **`No valid Garmin login tokens`:** run `npm run garmin:login` in `backend/`.
- **`Live pulse disconnected: device … not found`:** the watch isn't
  broadcasting or is out of range; check `GARMIN_BLE_ADDRESS` with
  `npm run garmin:live:scan` in `backend/`.
