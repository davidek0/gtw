"""Transport-agnostic turn logic, shared by the terminal chat and the voice bot.

The transport calls start(), then handle() for every final user transcript and
handle_silence() when nobody speaks in time, and close() when the session is over.
"""

import asyncio
import logging
import re
import time
from collections.abc import AsyncIterator, Callable
from contextlib import aclosing
from dataclasses import dataclass
from functools import partial
from typing import Literal, NamedTuple
from uuid import uuid4

from gtw import controller, extractor, prompts, red_flags
from gtw.config import Settings
from gtw.db import CheckinStore, DeviceState
from gtw.fields import FIELDS_BY_NAME, FieldSpec
from gtw.llm import ChatLLM, LLMError, Messages, ProxyLLM
from gtw.state import CheckinState, CheckinStatus, FieldState, Patient, Turn, utcnow

log = logging.getLogger(__name__)

MAX_READBACKS = 2
MAX_SILENCES = 2


@dataclass(frozen=True)
class Speech:
    """A piece of a reply. The kind tells the transport how to voice it."""

    text: str
    kind: Literal["acknowledgement", "alarm", "reply"] = "reply"


async def up_to_first_question(chunks: AsyncIterator[str]) -> AsyncIterator[str]:
    """Pass text through up to and including the first question mark, then close the stream.

    Enforces one question per reply regardless of what the model generates.
    """
    async with aclosing(chunks):
        async for chunk in chunks:
            if (end := chunk.find("?")) != -1:
                yield chunk[: end + 1]
                return
            yield chunk


def _last_question(text: str) -> str:
    questions = re.findall(r"[^.!?]*\?", text)
    return questions[-1].strip() if questions else text


class _Speculation(NamedTuple):
    messages: Messages
    reply: asyncio.Task[str | None]


class _Writer:
    """Runs store writes in order and off the event loop, so replies never wait on the database."""

    def __init__(self) -> None:
        self._queue: asyncio.Queue[Callable[[], None]] = asyncio.Queue()
        self._worker: asyncio.Task | None = None

    def submit(self, fn: Callable[..., None], *args, **kwargs) -> None:
        if self._worker is None:
            self._worker = asyncio.create_task(self._run())
        self._queue.put_nowait(partial(fn, *args, **kwargs))

    async def _run(self) -> None:
        while True:
            job = await self._queue.get()
            try:
                await asyncio.to_thread(job)
            except Exception:
                log.exception("Store write failed")
            finally:
                self._queue.task_done()

    async def close(self) -> None:
        await self._queue.join()
        if self._worker:
            self._worker.cancel()


class Dialogue:
    def __init__(self, patient: Patient, *, dialogue_llm: ChatLLM, extraction_llm: ChatLLM, store: CheckinStore):
        self.state = CheckinState.new(patient)
        self.checkin_id = str(uuid4())
        self.outcome: CheckinStatus | None = None
        self._dialogue_llm = dialogue_llm
        self._extraction_llm = extraction_llm
        self._store = store
        self._writer = _Writer()
        self._question = prompts.greeting(patient.name)
        self._readbacks = 0
        self._asked_correction = False
        self._silences = 0

    @property
    def ended(self) -> bool:
        return self.outcome is not None

    @property
    def patient_id(self) -> str:
        return self.state.patient.id

    def set_device_state(self, state: DeviceState) -> None:
        """Queue a device state change behind the dialogue's own writes; ignored once the session ended."""
        if not self.ended:
            self._writer.submit(self._store.set_device_state, self.patient_id, state)

    async def start(self) -> str:
        self._writer.submit(self._store.start_checkin, self.checkin_id, self.patient_id, utcnow())
        return self._say(self._question)

    async def handle(self, text: str) -> AsyncIterator[Speech]:
        """Process one final user transcript and yield the reply.

        It opens with a short acknowledgement, said before any LLM call so there is no dead air.
        """
        if self.ended:
            return
        self._silences = 0
        self._add_turn("user", text)

        if hit := red_flags.check(text):
            yield Speech(self._red_flag(text, hit), "alarm")
            return
        acknowledgement = prompts.acknowledgement(self._user_turns)
        self._add_turn("assistant", acknowledgement)
        yield Speech(acknowledgement, "acknowledgement")
        try:
            async for speech in self._respond(text):
                yield speech
        except LLMError:
            log.exception("LLM unavailable after all fallbacks")
            yield Speech(self._finish(prompts.TECHNICAL_PROBLEM, "partial"))

    async def handle_silence(self) -> str:
        """Re-ask once; the second silence in a row ends the check-in."""
        self._silences += 1
        if self._silences < MAX_SILENCES:
            return self._say(prompts.retry(self._question))
        return self._finish(prompts.NO_ANSWER, self._unfinished_status)

    async def close(self) -> None:
        """End the session whatever happened, return the device to idle and flush all writes."""
        if not self.ended:
            self._finalize(self._unfinished_status)
        self._writer.submit(self._store.set_device_state, self.patient_id, "idle")
        await self._writer.close()

    async def _respond(self, text: str) -> AsyncIterator[Speech]:
        reading_back = self._readbacks > 0
        fields = controller.applicable_fields(self.state) if reading_back else controller.open_fields(self.state)
        speculation = None if reading_back else self._speculate()
        try:
            started = time.perf_counter()
            result = await extractor.extract(self._extraction_llm, text, fields, self.state)
            log.info(
                "Extraction: %d update(s), intent %s, in %.0f ms",
                len(result.updates),
                result.intent,
                (time.perf_counter() - started) * 1000,
            )

            if result.intent == "stop":
                yield Speech(self._finish(prompts.STOP_GOODBYE, "partial"))
                return
            # Neither a repeat request nor a question is an answer, so no attempt is charged for them.
            if not result.updates and (result.intent == "repeat" or (reading_back and result.intent == "question")):
                yield Speech(self._say(prompts.repeat(self._question)))
                return
            if reading_back:
                yield Speech(self._after_readback(result))
                return

            answering_question = not result.updates and result.intent == "question"
            if not answering_question:
                controller.register_turn(self.state, result.updates)
            field = self._field_to_ask(keep_target=answering_question)
            if field is None:
                yield Speech(self._readback())
                return

            self.state.target = field.name
            messages = prompts.dialogue_messages(self.state, field, answer_question=answering_question)
            if speculation and speculation.messages == messages and (reply := await speculation.reply):
                log.info("Used the question generated during extraction")
                yield Speech(reply)
            else:
                if speculation:
                    speculation.reply.cancel()
                reply = ""
                async for chunk in up_to_first_question(self._dialogue_llm.stream(messages)):
                    reply += chunk
                    yield Speech(chunk)
            self._add_turn("assistant", reply.strip())
            self._question = _last_question(reply.strip())
            self._save_progress()
        finally:
            if speculation:
                speculation.reply.cancel()

    def _field_to_ask(self, *, keep_target: bool) -> FieldSpec | None:
        target = self.state.target
        if keep_target and target and controller.is_open(self.state.fields[target]):
            return FIELDS_BY_NAME[target]
        return controller.next_field(self.state)

    def _speculate(self) -> _Speculation | None:
        """Start generating the likely next question while extraction runs.

        Guesses that the answer settles the field being asked about. The result is only used if the
        prompt built after extraction is identical, so code still decides what gets asked.
        """
        guess = self.state.model_copy(deep=True)
        if guess.target:
            guess.fields[guess.target].status = "complete"
            guess.fields[guess.target].attempts += 1
        if (field := controller.next_field(guess)) is None:
            return None
        guess.target = field.name
        messages = prompts.dialogue_messages(guess, field)
        return _Speculation(messages, asyncio.create_task(self._generate(messages)))

    async def _generate(self, messages: Messages) -> str | None:
        try:
            return "".join([chunk async for chunk in up_to_first_question(self._dialogue_llm.stream(messages))])
        except LLMError:
            return None

    def _readback(self) -> str:
        self._readbacks += 1
        self._question = prompts.readback(self.state)
        return self._say(self._question)

    def _after_readback(self, result: extractor.ExtractionResult) -> str:
        corrections = [update for update in result.updates if controller.would_change(self.state, update)]
        for update in corrections:
            controller.apply_update(self.state, update)
        if corrections and self._readbacks < MAX_READBACKS:
            return self._readback()
        if result.confirmed is False and not corrections and not self._asked_correction:
            self._asked_correction = True
            self._question = _last_question(prompts.ASK_CORRECTION)
            return self._say(prompts.ASK_CORRECTION)
        return self._finish(prompts.GOODBYE, "completed")

    def _red_flag(self, text: str, hit: red_flags.RedFlagHit) -> str:
        log.warning("Red flag %r in %r", hit.phrase, text)
        self._writer.submit(
            self._store.insert_alert, self.patient_id, self.checkin_id, "red_flag", f'Varningssignal: "{text}"'
        )
        self.set_device_state("alert")
        self._writer.submit(self._store.mark_red_flag, self.checkin_id)
        return self._finish(red_flags.RED_FLAG_SCRIPT, "red_flag")

    def _finish(self, text: str, status: CheckinStatus) -> str:
        self._add_turn("assistant", text)
        self._finalize(status)
        return text

    def _finalize(self, status: CheckinStatus) -> None:
        self.outcome = status
        if status == "missed":
            self._writer.submit(
                self._store.insert_alert, self.patient_id, self.checkin_id, "missed_checkin", "Missad incheckning."
            )
        self._writer.submit(
            self._store.finish_checkin,
            self.checkin_id,
            status=status,
            respondent=self.state.respondent,
            summary=prompts.summary(self.state) if self._readbacks else None,
            ended_at=utcnow(),
            transcript=list(self.state.transcript),
            fields=self._fields_snapshot(),
        )

    def _say(self, text: str) -> str:
        self._add_turn("assistant", text)
        self._save_progress()
        return text

    def _add_turn(self, role: Literal["assistant", "user"], text: str) -> None:
        self.state.transcript.append(Turn(role=role, text=text))

    def _save_progress(self) -> None:
        self._writer.submit(
            self._store.save_progress, self.checkin_id, list(self.state.transcript), self._fields_snapshot()
        )

    def _fields_snapshot(self) -> list[FieldState]:
        return [self.state.fields[spec.name].model_copy(deep=True) for spec in controller.applicable_fields(self.state)]

    @property
    def _user_turns(self) -> int:
        return sum(turn.role == "user" for turn in self.state.transcript)

    @property
    def _unfinished_status(self) -> CheckinStatus:
        return "partial" if self._user_turns else "missed"


def create_dialogue(patient: Patient, store: CheckinStore, settings: Settings) -> Dialogue:
    def llm(model: str, timeout_s: float, json_mode: bool = False) -> ProxyLLM:
        return ProxyLLM(
            settings.llm_base_url, settings.litellm_master_key, model=model, timeout_s=timeout_s, json_mode=json_mode
        )

    return Dialogue(
        patient,
        dialogue_llm=llm(settings.dialogue_model, settings.dialogue_timeout_s),
        extraction_llm=llm(settings.extraction_model, settings.extraction_timeout_s, settings.extraction_json_mode),
        store=store,
    )
