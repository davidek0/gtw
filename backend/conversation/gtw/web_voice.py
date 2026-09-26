"""Browser voice check-in over Pipecat SmallWebRTC.

The conversation and its generated summary stay in process memory. The browser
retrieves the summary once with an unguessable token, and the latest result per
patient is kept for the clinician view; no database is involved.

Run with: uv run python -m gtw.web_voice -t webrtc --host 0.0.0.0 --port 7860
"""

import logging
import re
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from pipecat.runner.run import app, main
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.transports.base_transport import TransportParams

from gtw.cli import LOG_FORMAT
from gtw.config import get_settings
from gtw.dialogue import Speech
from gtw.llm import ChatLLM, LLMError, ProxyLLM
from gtw.state import CheckinState, CheckinStatus, Patient, Turn
from gtw.voice_bot import preload_whisper, run_transport_checkin

log = logging.getLogger(__name__)

SUBJECT_ID = re.compile(r"^[A-Za-z0-9._-]{1,200}$")
RESULT_TOKEN = re.compile(r"^[0-9a-f-]{36}$")
RESULTS: dict[str, dict[str, Any]] = {}
# The latest finished result per subjectId, kept for the server's lifetime.
LATEST_CHECKINS: dict[str, dict[str, Any]] = {}
MISSED_SUMMARY = "Ingen kontakt vid dagens incheckning – patienten svarade inte."


class BrowserDialogue:
    """One open question, followed by listening until the patient ends the call."""

    def __init__(self, patient: Patient):
        self.state = CheckinState.new(patient)

    @property
    def ended(self) -> bool:
        # The patient, not the scripted dialogue, decides when this call ends.
        return False

    @property
    def status(self) -> CheckinStatus:
        answered = any(turn.role == "user" and turn.text.strip() for turn in self.state.transcript)
        return "completed" if answered else "missed"

    def set_device_state(self, _state: str) -> None:
        # Browser check-ins are intentionally stateless and have no device row.
        return None

    async def start(self) -> str:
        greeting = f"Hej {self.state.patient.name}. Hur mår du idag?"
        self._add_turn("assistant", greeting)
        return greeting

    async def handle(self, text: str) -> AsyncIterator[Speech]:
        self._add_turn("user", text)
        reply = "Tack, jag har noterat det. Berätta gärna mer, eller tryck på avsluta samtalet när du är klar."
        self._add_turn("assistant", reply)
        yield Speech(reply)

    async def handle_silence(self) -> str:
        if any(turn.role == "user" for turn in self.state.transcript):
            reply = "Jag finns kvar. Tryck på avsluta samtalet när du känner dig klar."
        else:
            reply = "Jag lyssnar. Berätta med egna ord hur du mår idag."
        self._add_turn("assistant", reply)
        return reply

    async def close(self) -> None:
        return None

    def _add_turn(self, role: str, text: str) -> None:
        self.state.transcript.append(Turn(role=role, text=text))


@app.get("/api/checkin-results/{result_token}")
async def checkin_result(result_token: str) -> dict[str, Any]:
    """Return a completed summary once, then forget it on the voice server."""
    if not RESULT_TOKEN.fullmatch(result_token):
        raise HTTPException(status_code=404, detail="Unknown result token")
    result = RESULTS.get(result_token)
    if result is None:
        raise HTTPException(status_code=404, detail="Unknown result token")
    if not result.get("ready"):
        return result
    return RESULTS.pop(result_token)


@app.get("/api/latest-checkins")
async def latest_checkins() -> dict[str, dict[str, Any]]:
    """The latest finished check-in per subjectId, for the clinician view."""
    return LATEST_CHECKINS


async def bot(runner_args: RunnerArguments) -> None:
    body = runner_args.body if isinstance(runner_args.body, dict) else {}
    subject_id = str(body.get("subjectId", "person-1")).strip()
    patient_name = str(body.get("patientName", "Artur Rekstad")).strip()[:200]
    result_token = str(body.get("resultToken", "")).strip().lower()
    if not SUBJECT_ID.fullmatch(subject_id):
        raise ValueError("subjectId contains unsupported characters")
    if not patient_name:
        raise ValueError("patientName is required")
    if not RESULT_TOKEN.fullmatch(result_token):
        raise ValueError("A valid resultToken is required")

    settings = get_settings()
    patient = Patient(id=subject_id, name=patient_name)
    dialogue = BrowserDialogue(patient)
    RESULTS[result_token] = {"ready": False}
    _limit_pending_results()

    transport = await create_transport(
        runner_args,
        {
            "webrtc": lambda: TransportParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
            ),
        },
    )
    try:
        await run_transport_checkin(
            dialogue,
            transport,
            handle_sigint=runner_args.handle_sigint,
        )
        llm = ProxyLLM(
            settings.llm_base_url,
            settings.litellm_master_key,
            model=settings.dialogue_model,
            timeout_s=settings.dialogue_timeout_s,
        )
        result = await summarize(dialogue, llm)
    except Exception:
        RESULTS[result_token] = {
            "ready": True,
            "error": "Samtalet avslutades innan en sammanfattning kunde skapas.",
        }
        raise
    RESULTS[result_token] = {"ready": True, **result}
    LATEST_CHECKINS[subject_id] = result


async def summarize(dialogue: BrowserDialogue, llm: ChatLLM) -> dict[str, Any]:
    """The finished result; a missed check-in gets a fixed summary without an LLM call."""
    ended_at = datetime.now(UTC).isoformat()
    status = dialogue.status
    summary = MISSED_SUMMARY if status == "missed" else await _rewrite_summary(dialogue, llm)
    return {"summary": summary, "status": status, "endedAt": ended_at}


async def _rewrite_summary(dialogue: BrowserDialogue, llm: ChatLLM) -> str:
    transcript = "\n".join(
        f"{'AI' if turn.role == 'assistant' else dialogue.state.patient.name}: {turn.text.strip()}"
        for turn in dialogue.state.transcript
        if turn.text.strip()
    )[-12_000:]
    try:
        summary = await llm.complete(
            [
                {
                    "role": "system",
                    "content": (
                        "Du sammanfattar en patients muntliga incheckning för vårdpersonal. "
                        "Skriv 1–3 korta, sakliga meningar på svenska i tredje person. "
                        'Kalla patienten vid namn eller "patienten", aldrig han, hon eller andra könade '
                        "pronomen; gissa inte kön utifrån namnet. "
                        "Ta bara med sådant patienten själv har berättat. Hitta inte på, ställ "
                        "ingen diagnos och ge inga medicinska råd. Svara endast med sammanfattningen."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Patient: {dialogue.state.patient.name}\n\nSamtal:\n{transcript}",
                },
            ]
        )
    except LLMError:
        log.exception("Could not generate the local browser summary")
        raise
    if not summary:
        raise ValueError("The LLM returned an empty summary")
    return summary[:2_000]


def _limit_pending_results() -> None:
    """Bound memory if browsers disconnect and never retrieve their result."""
    while len(RESULTS) > 100:
        RESULTS.pop(next(iter(RESULTS)))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT)
    for noisy in ("aioice", "httpx"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    preload_whisper(get_settings())
    main()
