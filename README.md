# GTW Hackathon

Repository for the Gbg Tech Week x Chalmers Hackathon.

## Start the complete local demo

Put the Garmin watch in **Broadcast Heart Rate** mode, then run this once from
the repository root:

```powershell
npm run dev
```

This starts the frontend, backend, and continuous Garmin Bluetooth heart-rate
monitor together. As soon as the backend is ready, it also runs one Garmin Cloud
sync for sleep, steps, pulse, HRV, and the other configured health metrics. The
live monitor reconnects automatically if Bluetooth is briefly lost. Press
`Ctrl+C` to stop the complete app.
