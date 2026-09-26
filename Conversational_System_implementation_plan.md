# GTW – Conversation backend: implementation plan

Hackathon build (24h), Open Health Track. This plan is written for Claude Code.

> **Scope of this plan:** ONLY the backend for the patient conversation: the voice check-in
> that asks the questions, understands the answers, fills in the fields, detects red flags,
> and writes the results to the database.
>
> **Not in this plan** (built by teammates; do not implement them here):
> the dashboard and device mock page (Lovable), risk scoring, patient ranking and route
> prioritisation, and demo seed data for the dashboard. This backend only has to produce
> check-in data in the agreed format (section 8) so those parts can consume it.

Read the whole plan before starting. Work phase by phase, and don't start a phase before
the previous phase's acceptance criteria pass.

---

## 1. Context and responsibilities

The overall product is a decision-support system for hospital-at-home: elderly patients
(or a proxy: a relative or home-care worker) do a daily voice check-in with a home device.
Other parts of the system use the results to raise alarms and rank which patients the
doctor should visit today.

**This backend is responsible for:**
1. Starting a check-in when requested, and handling no-answer (missed check-in).
2. Running the Swedish voice conversation: asking the questions, one field at a time,
   until each field is filled, declined or unclear.
3. Extracting structured answers from free speech, including answers given out of order.
4. Detecting red flags on every turn, speaking a fixed safety script, and writing an alert.
5. Reading back a summary for confirmation, then saving the finished check-in.
6. Keeping the live device state updated (so the device mock page can show it).

### Core design principles (do not violate)
- **The LLM only phrases questions and extracts answers. Plain code decides** which field
  to ask next, when a field is done, and whether a red flag fired.
- **Red flags bypass everything.** Keyword/rule checks run on every final transcript *before*
  the LLM, and trigger a fixed script plus an alert. Never leave this to the prompt.
- **The agent never gives medical advice or diagnoses.** It only collects information.
- **"declined" and "unclear" are valid final field states.** Max 2 attempts per field,
  then move on. Don't pester.
- **A missed check-in is data too**: always save it with `status=missed`.
- **Build text-first, then add voice.** The whole dialogue must work in a terminal before
  any audio is involved.

### Out of scope
Everything listed in the scope note above, plus: real hardware, 4G, wearables/vitals,
a real alarm central, auth, EU hosting, production RLS, clinical validation of questions.

---

## 2. Architecture

```
[Home device (laptop mic/speaker)] <-> [THIS BACKEND: Python / Pipecat voice agent]
                                          |  STT (sv-SE) -> red-flag check -> extractor
                                          |  -> controller -> dialogue LLM -> TTS
                                          v
                                 [Supabase Postgres + Realtime]
                                          ^
                                          |  (not in this plan)
                     [Lovable dashboard + device page]   [Scoring / ranking]
```

**Integration contract = the database.** This backend never calls the dashboard or the
scoring code directly:
- **Input:** a row in `checkin_requests` (inserted by the dashboard or device page) starts a check-in.
- **Live output:** `device_state` (idle / ringing / listening / thinking / speaking / alert).
- **Final output:** `checkins`, `checkin_fields`, `alerts`, in the format defined in section 8.
  Scoring picks up finished check-ins from there.

For the demo, audio runs through the laptop's mic and speaker (local audio transport).
The Lovable device page is only a visual mock driven by `device_state`.

---

## 3. Tech stack and providers

| Concern | Choice | Notes |
|---|---|---|
| Language | Python 3.11+, managed with `uv` | |
| Voice framework | **Pipecat** (local audio transport for the demo) | Alternative: LiveKit Agents `console` mode. APIs change between versions: **read the installed version's docs/examples before writing pipeline code.** |
| LLM | Gonka network via OpenAI-compatible brokers | Primary: `deepseek-ai/DeepSeek-V4-Flash-0731` (fast, 100% OK at last check). Fallback: `MiniMaxAI/MiniMax-M2.7`. **Do not use `zai-org/GLM-5.3-Flash` in the live path** (20% OK at last check). |
| LLM fallback/routing | **LiteLLM proxy** running locally | One OpenAI-compatible endpoint (`http://localhost:4000`) that falls back across brokers and models on 429/timeout. The agent only ever talks to the proxy. |
| STT | Swedish-capable streaming STT, configurable | Default suggestion: Azure Speech `sv-SE` (STT + TTS from one provider). Verify Swedish support and free tier in Phase 0. Keep the provider swappable via config. |
| TTS | Swedish neural voice, configurable | Calm voice, slightly slower rate. |
| Database | Supabase (Postgres + Realtime) | Shared with the rest of the team. |

### LLM brokers (from the event credits sheet)
Each broker has its own base URL and key. Credits can't move between brokers.
Get keys from several and put them all in the LiteLLM fallback chain:
Dahl, Proxy by Gonka.gg, Gonka-api, JoinGonka, Hyperfusion, Gonka24, Gonkarouter.
Error 429 = network temporarily out of capacity: fall back immediately, don't retry in place.

---

## 4. Repository layout

```
gtw-conversation/
  IMPLEMENTATION_PLAN.md
  .env.example              # every variable, no real values
  pyproject.toml
  litellm/config.yaml       # model list + fallbacks across brokers
  supabase/migrations/001_conversation.sql
  gtw/
    config.py               # env loading, settings
    db.py                   # Supabase client helpers (service role key, backend only)
    fields.py               # field schema, questions (patient + proxy), order, conditions
    state.py                # FieldState, CheckinState (Pydantic)
    controller.py           # next_field(), attempt counting, completion check
    extractor.py            # LLM -> validated field updates (JSON)
    red_flags.py            # Swedish keyword/rule matcher + fixed script
    prompts.py              # dialogue system prompt builder, readback
    dialogue.py             # transport-agnostic turn logic (used by CLI and voice)
    cli_chat.py             # text-only check-in in the terminal (Phase 2)
    voice_bot.py            # Pipecat pipeline wrapping dialogue.py (Phase 3)
    runner.py               # listens for checkin_requests, runs sessions, handles missed
  scripts/
    bench_llm.py            # latency + JSON/tool-call + Swedish check per broker/model
    test_speech.py          # STT + TTS round trip in Swedish
    dev_seed.py             # 2–3 test patients for development only
  tests/
    test_controller.py
    test_red_flags.py
    test_extractor_validation.py
    test_dialogue_scripted.py   # scripted conversations with a stubbed LLM
```

Never commit `.env`. Never hardcode keys.

---

## 5. Database tables this backend uses

Coordinate with the teammate who owns the full schema. If these tables don't exist yet,
create them in `supabase/migrations/001_conversation.sql`. Don't create or modify the
scoring/dashboard tables (e.g. assessments, weights, ranking views).

| Table | Access | Columns |
|---|---|---|
| **patients** | read only | `id uuid pk`, `name text`, `age int`, `proxy_name text`, `modules text[]` (mock only), `checkin_time time` |
| **checkin_requests** | read + update status | `id`, `patient_id fk`, `created_at`, `status text` (`pending\|running\|done\|failed`) |
| **device_state** | write | `patient_id pk fk`, `state text` (`idle\|ringing\|listening\|thinking\|speaking\|alert`), `updated_at` |
| **checkins** | write | `id`, `patient_id`, `started_at`, `ended_at`, `status text` (`completed\|partial\|missed\|red_flag`), `respondent text` (`patient\|proxy\|unknown`), `summary text`, `transcript jsonb` (list of `{role, text, ts}`) |
| **checkin_fields** | write | `id`, `checkin_id fk`, `field text`, `value jsonb`, `status text` (`complete\|partial\|declined\|unclear\|empty`), `evidence text`, `attempts int` |
| **alerts** | write | `id`, `patient_id`, `checkin_id null`, `created_at`, `kind text` (`red_flag\|missed_checkin`), `message text`, `acknowledged bool default false` |

RLS: permissive for the hackathon (the frontend needs anon read on `device_state` and
anon insert on `checkin_requests`). Note in the migration that this must be locked down
for real use. Enable Realtime on `checkin_requests`, `device_state`, `checkins`, `alerts`.

---

## 6. Check-in content

### Fields (daily core, asked in this order)

| field | type | patient question (sv) | proxy question (sv) |
|---|---|---|---|
| `respondent` | `patient\|proxy` | "Är det {name} jag pratar med, eller någon annan?" | same |
| `trend` | `better\|same\|worse` | "Hur mår du idag jämfört med igår – bättre, samma eller sämre?" | "Verkar {name} annorlunda än vanligt idag?" |
| `breathing` | `better\|same\|worse` | "Har du varit mer andfådd än vanligt?" | "Andas {name} tyngre än vanligt?" |
| `confusion` | `bool` (more than usual) | "Har du känt dig tröttare eller mer virrig än vanligt?" | "Har {name} varit mer förvirrad eller sömnig än vanligt?" |
| `intake` | `normal\|less` | "Har du ätit och druckit ungefär som vanligt?" | "Har {name} ätit eller druckit mindre än vanligt?" |
| `mobility` | `{fell: bool, more_help: bool}` | "Har du ramlat, eller haft svårare att ta dig runt?" | "Har {name} ramlat eller behövt mer hjälp att röra sig eller gå på toaletten?" |
| `pain` | `{new_or_worse: bool, score_0_10: int\|null}` | "Har du någon ny smärta, eller värre än förut? Hur ont, från 0 till 10?" | "Verkar {name} ha ont?" |
| `medications` | `taken\|missed\|unsure` | "Har du tagit dina mediciner som vanligt?" | same, about {name} |
| `other` | `str\|null` | "Är det något mer du vill att sjuksköterskan ska veta?" | same |

Conditional: `pain.score_0_10` only if `new_or_worse` is true, and only asked of the patient.
Module fields (stretch goal): `heart_failure` → `weight_kg`, `ankle_swelling`, `orthopnea`.

Put all of this in `fields.py` as data (a list of field specs with `name`, `description`,
`value_schema`, `q_patient`, `q_proxy`, `condition`), not scattered in prompts.
The final question list will be reviewed by teammates and clinicians, so it must be
easy to edit in one place.

### Red flags (`red_flags.py`)
Demo list only; a real list must come from clinicians. Case-insensitive, tolerant matching
(STT errors). Include at least:
`ont i bröstet`, `bröstsmärta`, `tryck över bröstet`, `får ingen luft`, `kan inte andas`,
`slog i huvudet`, `kommer inte upp`, `kan inte resa mig`, `sluddrar`, `sned i ansiktet`,
`vill inte leva`, `vill dö`, `ta mitt liv`.

On a match: set `device_state=alert`, insert an `alerts` row, interrupt any TTS, speak the fixed script:
> "Det du berättar kan vara allvarligt. Jag skickar ett larm till vårdpersonalen nu. Om det känns akut, ring 112 direkt."

Then end the check-in with `status=red_flag` (keep the fields collected so far).

### Dialogue system prompt (`prompts.py`, Swedish)
Built fresh every turn from: persona + patient name + respondent + field status list +
the target field (description and example question for the right respondent).
Rules in the prompt:
- Speak Swedish. Short sentences, one question at a time, warm and calm.
- Ask about the target field. Rephrase naturally; don't read the example verbatim every time.
- Briefly acknowledge the answer ("Okej, tack.") before the next question.
- Never give medical advice, interpretations or diagnoses. If asked, say the nurse or
  doctor will follow up.
- If the person wants to stop, respect it.
- Output only what should be spoken (no markdown, no lists).

### Readback and end
When `controller.is_complete()`: generate a 1–2 sentence Swedish summary from the field
values (template or LLM), ask "Stämmer det?". A yes finalises. A correction goes through
the extractor again, then one more readback at most, then finalise.

---

## 7. Turn logic (transport-agnostic, `dialogue.py`)

For each **final** user transcript:
1. `red_flags.check(text)` → on hit, run the red-flag path (section 6) and stop.
2. `extractor.extract(text, open_fields, recent_transcript)` → JSON
   `{"updates": [{"field", "value", "status", "evidence"}]}`, validated with Pydantic.
   Invalid updates are dropped, not guessed. Answers to *any* open field count, not just
   the target (people answer out of order).
3. `controller.register_turn(updates)` → updates state; increments `attempts` on the
   target field if it's still unresolved; after 2 attempts, mark it `unclear`.
4. `controller.next_field()` → next field in order whose condition holds and whose status
   is `empty` or `partial`. None → readback.
5. Build the prompt and stream the dialogue LLM reply to TTS.
6. Persist the transcript turn + field state (async; don't block the reply).

**Default is sequential extraction then dialogue** (simplest, correct). Measure it.
If extraction adds > ~800 ms, switch to the optimisation: run extraction in parallel and
give the dialogue LLM the next *two* open fields with the instruction "if the latest
answer already covers the first, ask about the second". Only use native tool calling
in the dialogue LLM if `bench_llm.py` shows it's reliable through the brokers.

Opening: device `ringing` → greeting "God morgon {name}, har du en stund att prata?" →
the `respondent` field. No speech within 30 s of the greeting (demo value) → retry once →
save the check-in with `status=missed` and insert an `alerts` row (`missed_checkin`).

---

## 8. Output contract (what downstream parts can rely on)

Scoring and the dashboard are built by teammates against this contract. Don't change it
without telling them.

- **Every** check-in attempt produces exactly one `checkins` row, including missed ones.
- `checkins.ended_at` and `checkins.status` are written **last**, after all
  `checkin_fields` rows are saved. A check-in with `ended_at` set is final;
  downstream code should trigger on that.
- One `checkin_fields` row per field in section 6 (conditional fields that didn't apply
  are omitted), with `value` matching the types in section 6 and `status` from the allowed set.
- `respondent` is always set (`unknown` if never established).
- `evidence` contains the patient's or proxy's own words the value came from.
- `summary` is the confirmed readback text (Swedish), or null if the call didn't reach readback.
- Red flags: `checkins.status=red_flag` and an `alerts` row, written immediately,
  not at the end of the call.
- `device_state` returns to `idle` when the session ends, whatever the outcome.

Provide a small JSON example of a finished check-in in `docs/output_example.json` for teammates.

---

## 9. Phases and acceptance criteria

### Phase 0 – Setup and spikes (~1.5 h)
- `uv` project, `.env.example`, Supabase keys in `.env`.
- `litellm/config.yaml` with DeepSeek-V4-Flash on ≥ 2 brokers, then MiniMax-M2.7 as fallback;
  proxy runs on `localhost:4000`.
- `scripts/bench_llm.py`: for each broker × model, measure time-to-first-token and total time
  (5 runs), check JSON-mode/structured output and tool calling, and run a Swedish check-in
  prompt. Print a table.
- `scripts/test_speech.py`: Swedish TTS of a sample question → play; record 5 s from the mic → STT → print.

✅ **Done when:** the proxy answers through fallback when the primary key is deliberately
broken, the bench table exists, and a Swedish sentence round-trips through STT and TTS.
Record the chosen extraction strategy (JSON mode vs tool calling) in this file.

### Phase 1 – Tables and dev data (~1 h)
- Apply `001_conversation.sql` (only if the tables don't already exist).
- `scripts/dev_seed.py` creates 2–3 test patients, e.g. **Karin, 84**, proxy "dottern Anna".
- `db.py` helpers for every write in section 8.

✅ **Done when:** the helpers can create a check-in with fields and an alert, and read it back.

### Phase 2 – Text-only dialogue (~3 h)
- `fields.py`, `state.py`, `controller.py`, `extractor.py`, `red_flags.py`, `prompts.py`,
  `dialogue.py`, `cli_chat.py`. `python -m gtw.cli_chat --patient Karin` runs a full check-in
  in the terminal via the LiteLLM proxy and writes results per section 8.
- Tests: controller ordering/conditions/attempt cap; red-flag matcher including near-miss
  spellings; extractor validation rejects bad values; scripted dialogues with a stubbed LLM.

✅ **Done when:**
- A proxy answering several fields in one sentence ("Hon verkar mer förvirrad idag och har
  knappt druckit något") fills both fields, and they aren't asked again.
- A red-flag sentence ends the check-in with the fixed script and an alert row.
- Declining a question marks it `declined` and moves on.
- Two unclear answers mark a field `unclear` and move on.
- The saved rows match the section 8 contract.

### Phase 3 – Voice (~3 h)
- `voice_bot.py`: Pipecat pipeline with local audio in/out → VAD → STT (sv-SE) → turn logic
  from `dialogue.py` → LLM (streaming, via the proxy) → TTS (sv-SE) → speaker.
  Reuse `dialogue.py`; do not duplicate logic.
- Turn detection: silence threshold ~1.0–1.5 s (elderly speakers pause mid-sentence).
  Barge-in enabled. Red-flag check on final transcripts only.
- Write `device_state` transitions (listening / thinking / speaking).
- Log per-turn latency: end of speech → first audio out.

✅ **Done when:** a full Swedish check-in works by voice and median turn latency is under ~2 s.

### Phase 4 – Request handling (~1.5 h)
- `runner.py`: subscribe (Realtime, or poll every 2 s as a fallback) to `checkin_requests`,
  start a voice session for that patient, mark the request `running/done/failed`,
  handle missed check-ins, and return `device_state` to `idle` at the end.
- One command starts everything (e.g. `make run` / `uv run gtw-run`): LiteLLM proxy + runner.

✅ **Done when:** inserting a `checkin_requests` row (from the Lovable button or manually in
SQL) makes the laptop start the conversation, and the finished check-in appears in the
database per section 8.

### Phase 5 – Hardening (~1.5 h)
- Run the three acceptance conversations (section 10) end to end ≥ 3 times each.
- Test on a phone hotspot.
- Graceful degradation: if the LLM fails after all fallbacks, speak "Jag har lite tekniska
  problem, vårdpersonalen hör av sig" and save a `partial` check-in.
- Help the team record a backup video of a successful run.

✅ **Done when:** three clean runs in a row per scenario.

### Stretch (only if everything above is done)
Heart-failure module fields; device heartbeat; confidence per field; a short
LLM-generated note for the nurse from the transcript (non-live).

---

## 10. Acceptance conversations

1. **Proxy, deterioration (main demo).** Karin's daughter answers. Key line:
   "Hon verkar mer förvirrad idag och har knappt druckit något." → `respondent=proxy`,
   `confusion=true`, `intake=less`, readback confirmed, `status=completed`.
2. **Patient, stable.** Karin answers herself, everything as usual, one declined question
   → `status=completed`, one field `declined`.
3. **Red flag.** "Han har ont i bröstet." → fixed script, `alerts` row within ~1 s,
   `status=red_flag`, `device_state=alert` then `idle`.
4. *(Bonus)* **No answer.** Nobody speaks → retry → `status=missed` + `missed_checkin` alert.

---

## 11. Working rules for Claude Code
- Stay within the scope note at the top. If something needed seems to belong to scoring,
  ranking or the dashboard, stop and note it in this file instead of building it.
- Check the installed versions' docs before using Pipecat, LiteLLM or supabase-py APIs;
  don't rely on memory for their interfaces.
- Keep `dialogue.py` free of transport code so the CLI and voice share identical behaviour.
- Pure functions + tests for `controller.py`, `red_flags.py` and extractor validation.
- Every LLM call goes through the LiteLLM proxy with a timeout (dialogue ~8 s, extraction ~5 s).
- All user-facing speech in Swedish; code, comments and logs in English.
- Mock data only. No real patient data anywhere.
- After each phase: run the tests, update the checkboxes below, commit.

### Progress
- [ ] Phase 0 – setup and spikes
- [ ] Phase 1 – tables and dev data
- [ ] Phase 2 – text-only dialogue
- [ ] Phase 3 – voice
- [ ] Phase 4 – request handling
- [ ] Phase 5 – hardening

### Implementation notes
- Code lives in `backend/conversation/` (package `gtw/`), a self-contained uv project next to the team's `backend/analysis/`.
- **Phase 0:** proxy fallback verified locally against fake brokers (429 and 401 on the
  primary both fall through to broker B). Benchmark run 2026-09-26 on broker A (Gonka via a Supabase function) and
  broker B (Hyperfusion); both serve DeepSeek-V4-Flash and MiniMax-M2.7, GLM is not usable (timeouts / 401).
  With default settings both models reason before answering: extraction 3.4–17 s. DeepSeek with
  `chat_template_kwargs: {thinking: false}` skips reasoning with the same extraction result: extraction ~0.6–1.8 s,
  dialogue time-to-first-token ~0.4–0.7 s, with occasional 6–16 s outliers. MiniMax cannot turn reasoning off.
  JSON mode and tool calling both work on DeepSeek. **Chosen extraction strategy: JSON mode, reasoning off**
  (set per deployment in `litellm/config.yaml`, verified to reach the broker through the proxy).
  Through the proxy: time-to-first-token ~0.2 s, extraction ~0.6–1.5 s, so sequential extraction stays within budget.
  STT/TTS: fully local, chosen by the team. KB-Whisper medium (faster-whisper, CUDA, int8_float16) and Piper
  `sv_SE-lisa-medium`. Round trip on the demo laptop (RTX 3050): ~0.5 s STT for 5 s of speech, ~150 ms TTS per sentence,
  transcripts exact. `test_speech.py` does speaker → mic → transcript.
- Proxy: Hyperfusion (B) is primary as it was more reliable; chain is DeepSeek B → DeepSeek A → MiniMax B → MiniMax A.
  Timeouts are per attempt in the proxy (DeepSeek 4 s / 3 s per stream chunk, MiniMax 10 s / 8 s), verified to fall back
  on a hanging broker. The agent-side timeouts (extraction 15 s, dialogue 12 s) are therefore longer than the plan's
  5 s / 8 s: they cover the whole chain, so a slow broker falls back instead of ending the check-in.
- **Phase 1:** migration, `db.py` and `dev_seed.py` / `db_smoke.py` are written but not yet run
  against the team's Supabase project.
- **Phase 2:** all modules and 63 tests pass. Acceptance conversations 1–3 pass live in text mode
  (`gtw-chat --dry-run` via the proxy); not yet run against Supabase.
- Dialogue prompt: the conversation goes to the LLM as quoted text in one "write your next line about X" task,
  not as chat turns. With chat turns the model steered the check-in itself and asked about already-answered
  fields ~60% of the time; with the task framing it stayed on target 16/16. Code also cuts each reply after the
  first question mark, enforcing one question per turn.
- **Phase 3:** `voice_bot.py` works end to end on the laptop mic and speaker (Pipecat 1.12, own processors rather
  than Pipecat's LLM aggregators). Measured turn latency ~3.1–3.2 s from end of speech to first audio:
  1.2 s end-of-turn silence + ~0.6 s STT + ~0.85 s extraction + ~0.4 s to the first spoken sentence.
  Barge-in is off by default (`BARGE_IN`): without echo cancellation the laptop mic hears the bot, so the mic is
  muted while the bot speaks. The mic also picks up background conversations in a noisy room; use a headset mic for the demo.
- **Conversation feel:**
  - Every reply opens with an instant acknowledgement ("Okej." / "Jag förstår." / "Ja, okej.", rotated), said
    before any LLM call, so there is no dead air. "Mm." is not usable: Piper reads it as "millimeter".
  - The dialogue LLM may react briefly with empathy ("Oj, vad tråkigt att höra.") but still never assesses or advises.
  - The extractor classifies each utterance's `intent`: answer / repeat / question / stop. "Vad sa du?" repeats the
    last question verbatim; a question to the bot gets a short reply (health questions go to the nurse) and the same
    question again. Neither is charged as an attempt.
  - The readback only lists what differs from usual, plus "men annars är allt som vanligt".
  - Piper speaks ~15% slower (`PIPER_LENGTH_SCALE=1.15`).
  - Changed the proxy `trend` question to "Hur verkar {name} må idag jämfört med igår – bättre, samma eller
    sämre?" (the old yes/no wording never fit the value). **Needs clinician review.**
- **Latency, instead of the plan's parallel two-field variant:** while extraction runs, the likely next question
  (assuming the answer settles the current field) is generated in parallel and used only if the prompt built after
  extraction is identical. So code still decides what is asked, and the LLM is never offered a choice of fields,
  which is what made it drift. Live: 5 of 7 questions reused, saving ~1 s on those turns.
- The extractor returns `status: answered | declined` per update. Code, not the LLM, decides
  `complete` vs `partial`. Vague answers produce no update, and the attempt cap then marks the field `unclear`.
- A field that ran out of attempts with some parts known stays `partial`; with nothing known it becomes `unclear`.
- The readback summary is a Swedish template (`prompts.summary`), not LLM output.
- Red-flag list extended with inverted word order (`vill jag dö`, `vill jag inte leva`) and `sluddrig`.
  Negated statements (e.g. "inget ont i bröstet") still trigger. This is intentional (safety first), but clinicians should review it.
- Open question for the team: the pulled frontend (`frontend/`) currently reads from a Node
  `laptop-server`, not Supabase, and its Supabase types are empty. The integration contract
  here is the database (section 2).
