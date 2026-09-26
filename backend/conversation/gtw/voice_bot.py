"""Voice check-in on the laptop's mic and speaker: Silero VAD -> KB-Whisper -> dialogue -> Piper.

uv run gtw-voice --patient Karin            # writes to Supabase
uv run gtw-voice --patient Karin --dry-run  # in-memory, prints the result
"""

import asyncio
import logging
import re
import sys
import time
from collections.abc import AsyncIterator

from loguru import logger as pipecat_logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    EndWorkerFrame,
    Frame,
    InputAudioRawFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
    StartFrame,
    TranscriptionFrame,
    TTSSpeakFrame,
    VADUserStartedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.observers.user_bot_latency_observer import UserBotLatencyObserver
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineWorker, ProcessorUnusablePolicy
from pipecat.processors.audio.vad_processor import VADProcessor
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.services.piper.tts import PiperTTSService
from pipecat.services.whisper.stt import WhisperSTTService
from pipecat.transcriptions.language import Language
from pipecat.transports.base_transport import BaseTransport
from pipecat.transports.local.audio import LocalAudioTransport, LocalAudioTransportParams
from pipecat.workers.runner import WorkerRunner

from gtw.cli import LOG_FORMAT, parse_args, run_checkin
from gtw.config import get_settings
from gtw.dialogue import Dialogue, Speech
from gtw.speech import preload_cuda_libraries, vad_params

log = logging.getLogger(__name__)

WHISPER_TOKEN = re.compile(r"<\|[^|]*\|>")  # e.g. "<|nospeech|>", which KB-Whisper sometimes leaves in the text


class CalmPiperTTSService(PiperTTSService):
    """Piper with an adjustable speaking rate, which Pipecat's service does not expose."""

    def __init__(self, *, length_scale: float, **kwargs):
        super().__init__(**kwargs)
        self._voice.config.length_scale = length_scale  # > 1 speaks more slowly


class EchoGate(FrameProcessor):
    """Replaces mic audio with silence while the bot speaks, so it never hears itself."""

    def __init__(self, tail_s: float = 0.4):
        super().__init__()
        self._tail_s = tail_s
        self._bot_speaking = False
        self._muted_until = 0.0

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, BotStartedSpeakingFrame):
            self._bot_speaking = True
        elif isinstance(frame, BotStoppedSpeakingFrame):
            self._bot_speaking = False
            self._muted_until = time.monotonic() + self._tail_s
        elif isinstance(frame, InputAudioRawFrame) and (self._bot_speaking or time.monotonic() < self._muted_until):
            frame.audio = bytes(len(frame.audio))
        await self.push_frame(frame, direction)


class CheckinProcessor(FrameProcessor):
    """Feeds final transcripts to the dialogue and its replies to TTS; handles silence and device state."""

    def __init__(self, dialogue: Dialogue, *, silence_timeout_s: float, barge_in: bool):
        super().__init__()
        self._dialogue = dialogue
        self._silence_timeout_s = silence_timeout_s
        self._barge_in = barge_in
        self._turn_lock = asyncio.Lock()
        self._silence_task: asyncio.Task | None = None
        self._bot_speaking = False

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame):
            if text := WHISPER_TOKEN.sub("", frame.text).strip():
                self._cancel_silence_timer()
                self.create_task(self._user_turn(text))
            return

        await self.push_frame(frame, direction)
        if isinstance(frame, StartFrame):
            self.create_task(self._greet())
        elif isinstance(frame, VADUserStartedSpeakingFrame):
            log.info("Speech detected")
            self._cancel_silence_timer()
            if self._barge_in and self._bot_speaking:
                await self.broadcast_interruption()
        elif isinstance(frame, VADUserStoppedSpeakingFrame):
            log.info("End of speech, transcribing")
            self._restart_silence_timer()
        elif isinstance(frame, BotStartedSpeakingFrame):
            self._bot_speaking = True
            self._cancel_silence_timer()
            self._dialogue.set_device_state("speaking")
        elif isinstance(frame, BotStoppedSpeakingFrame):
            self._bot_speaking = False
            # Mid-turn (between the acknowledgement and the reply) the bot is still thinking, not listening.
            if not self._turn_lock.locked():
                self._dialogue.set_device_state("listening")
                self._restart_silence_timer()

    async def _greet(self) -> None:
        async with self._turn_lock:
            await self._say(await self._dialogue.start())

    async def _user_turn(self, text: str) -> None:
        log.info("Heard: %s", text)
        async with self._turn_lock:
            if self._dialogue.ended:
                return
            self._dialogue.set_device_state("thinking")
            await self._speak(self._dialogue.handle(text))

    async def _on_silence(self) -> None:
        await asyncio.sleep(self._silence_timeout_s)
        self._silence_task = None  # past the wait, so ending the session must not cancel this task
        async with self._turn_lock:
            await self._say(await self._dialogue.handle_silence())
            await self._end_if_done()

    async def _say(self, text: str) -> None:
        log.info("Bot: %s", text)
        await self.push_frame(TTSSpeakFrame(text))

    async def _speak(self, reply: AsyncIterator[Speech]) -> None:
        text = ""
        async for speech in reply:
            if speech.kind == "alarm":
                # The safety script must not wait behind anything already queued for TTS.
                await self.broadcast_interruption()
            if speech.kind != "reply":
                # Spoken at once, instead of waiting in the TTS sentence aggregator for what follows.
                await self._say(speech.text)
                continue
            if not text:
                await self.push_frame(LLMFullResponseStartFrame())
            text += speech.text
            await self.push_frame(LLMTextFrame(speech.text))
        if text:
            await self.push_frame(LLMFullResponseEndFrame())
            log.info("Bot: %s", text.strip())
        await self._end_if_done()

    async def _end_if_done(self) -> None:
        if self._dialogue.ended:
            self._cancel_silence_timer()
            # Pushed after the last words, so they are spoken before the pipeline closes.
            await self.push_frame(EndWorkerFrame())

    def _restart_silence_timer(self) -> None:
        self._cancel_silence_timer()
        if not self._dialogue.ended:
            self._silence_task = self.create_task(self._on_silence())

    def _cancel_silence_timer(self) -> None:
        if self._silence_task:
            self._silence_task.cancel()
            self._silence_task = None


async def run_transport_checkin(
    dialogue: Dialogue,
    transport: BaseTransport,
    *,
    handle_sigint: bool = True,
) -> None:
    settings = get_settings()
    preload_cuda_libraries()
    vad = VADProcessor(vad_analyzer=SileroVADAnalyzer(params=vad_params(settings)))
    stt = _create_whisper_stt(settings)
    tts = CalmPiperTTSService(
        length_scale=settings.piper_length_scale, settings=PiperTTSService.Settings(voice=settings.piper_voice)
    )
    checkin = CheckinProcessor(dialogue, silence_timeout_s=settings.no_answer_timeout_s, barge_in=settings.barge_in)

    echo_gate = [] if settings.barge_in else [EchoGate()]
    pipeline = Pipeline([transport.input(), *echo_gate, vad, stt, checkin, tts, transport.output()])
    latency = UserBotLatencyObserver()

    @latency.event_handler("on_latency_measured")
    async def log_latency(observer: UserBotLatencyObserver, seconds: float) -> None:
        log.info("Turn latency: %.0f ms from end of speech to first audio", seconds * 1000)

    worker = PipelineWorker(pipeline, observers=[latency], processor_unusable_policy=ProcessorUnusablePolicy.END)
    if transport.__class__.__name__ == "SmallWebRTCTransport":

        @transport.event_handler("on_client_disconnected")
        async def on_client_disconnected(_transport, _client) -> None:
            await worker.cancel(reason="Browser client disconnected")

    runner = WorkerRunner(handle_sigint=handle_sigint)
    await runner.add_workers(worker)

    dialogue.set_device_state("ringing")
    try:
        await runner.run()
    finally:
        await dialogue.close()


async def run_voice_checkin(dialogue: Dialogue) -> None:
    transport = LocalAudioTransport(LocalAudioTransportParams(audio_in_enabled=True, audio_out_enabled=True))
    await run_transport_checkin(dialogue, transport)


def _create_whisper_stt(settings):
    """Use the configured GPU when available, then fall back to CPU on CUDA driver errors."""
    options = WhisperSTTService.Settings(
        model=settings.whisper_model, language=Language.SV, no_speech_prob=settings.whisper_no_speech_prob
    )
    try:
        return WhisperSTTService(
            device=settings.whisper_device,
            compute_type=settings.whisper_compute_type,
            settings=options,
        )
    except RuntimeError as error:
        if settings.whisper_device != "cuda" or "CUDA" not in str(error):
            raise
        log.warning("Whisper CUDA is unavailable; falling back to CPU int8: %s", error)
        return WhisperSTTService(device="cpu", compute_type="int8", settings=options)


def main() -> None:
    args = parse_args(__doc__, "show Pipecat debug logs")
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT)
    pipecat_logger.remove()
    pipecat_logger.add(sys.stderr, level="DEBUG" if args.verbose else "WARNING")
    run_checkin(args, run_voice_checkin)


if __name__ == "__main__":
    main()
