"""Hearing test: shows what the voice bot's VAD and Whisper make of your voice.

uv run python scripts/mic_check.py [--seconds 20]

Speak a few sentences. For each one it prints whether the VAD counted it as speech and what
Whisper heard. Voice that the VAD finds too quiet is reported, so you know to raise the mic gain.
"""

import argparse
import asyncio
import time

import pyaudio
from faster_whisper import WhisperModel
from pipecat.audio.utils import exp_smoothing
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADState
from pipecat.audio.volume import AudioVolumeTracker

from gtw.config import get_settings
from gtw.speech import load_whisper, pcm16_to_float, vad_params

RATE, CHUNK = 16000, 512


def transcribe(model: WhisperModel, audio: bytes, no_speech_prob: float) -> None:
    segments = list(model.transcribe(pcm16_to_float(audio), language="sv")[0])
    kept = [s for s in segments if s.no_speech_prob < no_speech_prob]
    dropped = [s for s in segments if s.no_speech_prob >= no_speech_prob]
    print(f"  heard: {' '.join(s.text.strip() for s in kept) or '(nothing)'}")
    if dropped:
        listed = ", ".join(f"{s.text.strip()!r} (no_speech_prob {s.no_speech_prob:.2f})" for s in dropped)
        print(f"  dropped by Whisper as probably not speech: {listed}")


async def main() -> None:
    settings = get_settings()
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=float, default=20)
    args = parser.parse_args()

    model = load_whisper(settings)
    vad = SileroVADAnalyzer(params=vad_params(settings))
    vad.set_sample_rate(RATE)
    probe = SileroVADAnalyzer()  # separate model state: Silero is stateful, so the VAD's own must not be fed twice
    probe.set_sample_rate(RATE)
    min_volume = vad.params.min_volume
    tracker, volume = AudioVolumeTracker(), 0.0

    audio = pyaudio.PyAudio()
    stream = audio.open(format=pyaudio.paInt16, channels=1, rate=RATE, input=True, frames_per_buffer=CHUNK)
    print(f"Listening for {args.seconds:.0f} s. Speak Swedish at normal volume.")
    utterance, loudest, too_quiet_since = bytearray(), 0.0, 0.0
    deadline = time.monotonic() + args.seconds
    try:
        while time.monotonic() < deadline:
            chunk = stream.read(CHUNK, exception_on_overflow=False)
            tracker.update(chunk, RATE)
            volume = exp_smoothing(tracker.volume, volume, 0.2)
            state = await vad.analyze_audio(chunk)
            confidence = probe.voice_confidence(chunk)

            if state in (VADState.STARTING, VADState.SPEAKING, VADState.STOPPING):
                if not utterance:
                    print("speech detected...")
                utterance += chunk
                loudest = max(loudest, volume)
            elif utterance:
                print(f"  end of speech, loudest volume {loudest:.2f} (VAD needs {min_volume:.2f})")
                transcribe(model, bytes(utterance), settings.whisper_no_speech_prob)
                utterance, loudest = bytearray(), 0.0
            elif confidence >= vad.params.confidence and volume < min_volume:
                if time.monotonic() - too_quiet_since > 2:
                    print(f"voice heard but too quiet for the VAD: volume {volume:.2f} < {min_volume:.2f}")
                    too_quiet_since = time.monotonic()
    finally:
        stream.close()
        audio.terminate()


if __name__ == "__main__":
    asyncio.run(main())
