// Pulsefold laptop backend — plain Node, no dependencies.
// Run:    node laptop-server/server.js
// Tunnel: ngrok http 5000   (paste the https address into the app's /connect page)

import http from "node:http";

const PORT = process.env.PORT || 5000;

// TODO: replace this with your real data source (database, smartwatch export, etc.).
// Each patient must match the `Patient` type in src/lib/health-data.ts.
// `email` is what the patient types on the sign-in page.
const patients = [];

// Feelings sent from the app are kept here in memory.
// TODO: save them somewhere permanent (file/database).
const feelings = [];

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    // CORS so the phone app is allowed to call this program.
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, ngrok-skip-browser-warning",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

http
  .createServer(async (req, res) => {
    if (req.method === "OPTIONS") return send(res, 204);

    // GET /patients → list shown on the doctor worklist and patient overview
    if (req.method === "GET" && req.url === "/patients") {
      return send(res, 200, patients);
    }

    // POST /patients/:id/feelings ← { score: 1-5, at: ISO date }
    const m = req.url.match(/^\/patients\/([^/]+)\/feelings$/);
    if (req.method === "POST" && m) {
      const { score, at } = await readJson(req);
      if (!(score >= 1 && score <= 5)) return send(res, 400, { error: "score must be 1-5" });
      feelings.push({ patientId: decodeURIComponent(m[1]), score, at });
      // TODO: update the patient's "feeling" metric from these entries.
      return send(res, 201, { ok: true });
    }

    // TODO: add more endpoints here (login, notes, referrals, smartwatch uploads).
    send(res, 404, { error: "Not found" });
  })
  .listen(PORT, () => console.log(`Pulsefold backend on http://localhost:${PORT}`));
