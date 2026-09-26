"""Browser voice check-in over Pipecat SmallWebRTC.

The conversation and its generated summary stay in process memory. The browser
retrieves the summary once with an unguessable token; no database is involved.

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
from pipecat.transcriptions.language import Language
from pipecat.transports.base_transport import TransportParams

from gtw.config import Settings, get_settings
from gtw.dialogue import Speech
from gtw.llm import LLMError, ProxyLLM
from gtw.state import CheckinState, Patient, Turn
from gtw.voice_bot import run_transport_checkin

log = logging.getLogger(__name__)

SUBJECT_ID = re.compile(r"^[A-Za-z0-9._-]{1,200}$")
RESULT_TOKEN = re.compile(r"^[0-9a-f-]{36}$")
RESULTS: dict[str, dict[str, Any]] = {}


class BrowserDialogue:
    """One open question, followed by listening until the patient ends the call."""

    def __init__(self, patient: Patient):
        self.state = CheckinState.new(patient)

    @property
    def ended(self) -> bool:
        # The patient, not the scripted dialogue, decides when this call ends.
        return False

    def set_device_state(self, _state: str) -> None:
        # Browser check-ins are intentionally stateless and have no device row.
        return None

    async def start(self) -> str:
        greeting = f"Hello {self.state.patient.name}. How are you feeling today?"
        self._add_turn("assistant", greeting)
        return greeting

    async def handle(self, text: str) -> AsyncIterator[Speech]:
        self._add_turn("user", text)
        reply = "Thank you, I have noted that. Please tell me more, or end the conversation when you are ready."
        self._add_turn("assistant", reply)
        yield Speech(reply)

    async def handle_silence(self) -> str:
        if any(turn.role == "user" for turn in self.state.transcript):
            reply = "I am still here. End the conversation whenever you feel ready."
        else:
            reply = "I am listening. Please describe in your own words how you are feeling today."
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
            language=Language.EN,
            whisper_model=settings.browser_whisper_model,
            piper_voice=settings.browser_piper_voice,
        )
        summary = await _rewrite_summary(dialogue, settings)
        RESULTS[result_token] = {
            "ready": True,
            "summary": summary,
            "status": "completed",
            "endedAt": datetime.now(UTC).isoformat(),
        }
    except Exception:
        RESULTS[result_token] = {
            "ready": True,
            "error": "The conversation ended before a summary could be created.",
        }
        raise


async def _rewrite_summary(dialogue: BrowserDialogue, settings: Settings) -> str:
    user_turns = [
        turn.text.strip()
        for turn in dialogue.state.transcript
        if turn.role == "user" and turn.text.strip()
    ]
    if not user_turns:
        raise ValueError("The conversation did not contain a patient response")

    transcript = "\n".join(
        f"{'AI' if turn.role == 'assistant' else dialogue.state.patient.name}: {turn.text.strip()}"
        for turn in dialogue.state.transcript
        if turn.text.strip()
    )[-12_000:]
    llm = ProxyLLM(
        settings.llm_base_url,
        settings.litellm_master_key,
        model=settings.dialogue_model,
        timeout_s=settings.dialogue_timeout_s,
    )
    try:
        summary = await llm.complete(
            [
                {
                    "role": "system",
                    "content": (
                        "You summarize a patient's spoken check-in for healthcare professionals. "
                        "Write 1–3 short, factual sentences in English and in the third person. "
                        "Include only information the patient has provided. Do not invent details, "
                        "diagnose, or give medical advice. Return only the summary."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Patient: {dialogue.state.patient.name}\n\nConversation:\n{transcript}",
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
    main()
