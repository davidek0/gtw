# GTW Hackathon

Repository for the Gbg Tech Week x Chalmers Hackathon.

## Start the complete local demo

Put the Garmin watch in **Broadcast Heart Rate** mode, then run this once from
the repository root:

```powershell
npm run dev
```

This starts the frontend, backend, continuous Garmin Bluetooth heart-rate
monitor, the LLM proxy and the browser voice check-in together. Missing npm
dependencies are installed on the first run. As soon as the backend is ready, it
also runs one Garmin Cloud sync for sleep, steps, pulse, HRV, and the other
configured health metrics. The live monitor reconnects automatically if
Bluetooth is briefly lost. Press `Ctrl+C` to stop the complete app.

Configuration:

- `backend/.env` — Garmin backend and monitor (`DATABASE_URL`, `ADMIN_API_TOKEN`).
  Without them those two services are skipped and the rest of the demo still runs.
- `backend/conversation/.env` — LLM broker keys for the voice check-in
  (see `backend/conversation/.env.example`).

Open http://localhost:8080/overview for the patient's voice check-in and
http://localhost:8080/worklist for the clinician view.
