# GTW conversation backend

Swedish voice check-in: asks the daily questions, extracts answers, detects red flags and
writes results to Supabase. See `../Conversational_System_implementation_plan.md`.

## Setup

All commands run from `backend/conversation/`.

```bash
sudo apt install portaudio19-dev   # microphone/speaker access for the voice bot
cp .env.example .env               # fill in Supabase + broker keys
uv sync
```

Voice runs fully locally: [KB-Whisper](https://huggingface.co/KBLab/kb-whisper-medium) (the National Library
of Sweden's Whisper) on the GPU for STT, and a Swedish [Piper](https://github.com/rhasspy/piper) voice for TTS.
Both download on first use. The CUDA 12 libraries Whisper needs come from the `nvidia-*` Python packages.

Apply `supabase/migrations/001_conversation.sql` in the Supabase SQL editor (only if the
tables don't exist yet), then seed fictional test patients:

```bash
uv run python scripts/dev_seed.py
uv run python scripts/db_smoke.py        # writes and reads back a test check-in
```

## Running

```bash
# LiteLLM proxy on :4000, with the broker keys from .env exported
(set -a; source .env; uvx --from 'litellm[proxy]' litellm --config litellm/config.yaml --port 4000)

uv run gtw-chat --patient Karin --dry-run   # text check-in, in-memory, prints the result
uv run gtw-chat --patient Karin             # text check-in, writes to Supabase
uv run gtw-chat --patient Karin -v          # also logs extraction timings
```

An empty line in the chat counts as silence.

```bash
uv run python scripts/test_speech.py        # speak a question, record 5 s, transcribe
uv run python scripts/mic_check.py          # what the VAD and Whisper make of your voice
uv run gtw-voice --patient Karin --dry-run  # full voice check-in on the laptop mic and speaker
```

Speech settings live in `.env` (see `gtw/config.py`): `WHISPER_MODEL`, `PIPER_VOICE` (`sv_SE-lisa-medium`,
`sv_SE-alma-medium` or `sv_SE-nst-medium`), `PIPER_LENGTH_SCALE` (speaking rate, > 1 is slower),
`END_OF_TURN_SILENCE_S`, and `BARGE_IN`. Barge-in is off by default:
with laptop speakers the mic hears the bot, so the mic is muted while it speaks. Enable it only with a headset.

## Benchmarks and tests

```bash
uv run python scripts/bench_llm.py          # every broker x model in .env
uv run python scripts/bench_llm.py --proxy  # through the proxy
uv run pytest
```

## Layout

| Module | Role |
|---|---|
| `gtw/fields.py` | The questions as data: order, schemas, patient/proxy wording, conditions |
| `gtw/controller.py` | Plain-code flow: next field, attempt cap, completion |
| `gtw/red_flags.py` | Keyword matcher and fixed safety script, runs before any LLM call |
| `gtw/extractor.py` | LLM → validated field updates |
| `gtw/prompts.py` | Fixed lines, dialogue system prompt, readback summary |
| `gtw/dialogue.py` | Transport-agnostic turn logic shared by the CLI and voice |
| `gtw/db.py` | Supabase store and an in-memory store with the same interface |
| `gtw/llm.py` | Async client for the LiteLLM proxy |
| `gtw/voice_bot.py` | Pipecat pipeline: mic → VAD → KB-Whisper → dialogue → Piper → speaker |
| `gtw/speech.py` | Whisper, Piper and VAD setup shared by the bot and the speech scripts |
| `gtw/cli.py` | Command line shared by `gtw-chat` and `gtw-voice` |

`docs/output_example.json` shows a finished check-in in the output contract format.
