"""Swedish speech round trip: speak a question, record from the mic, transcribe it.

uv run python scripts/test_speech.py [--seconds 5] [--voice sv_SE-alma-medium]
"""

import argparse
import time

import numpy as np
import pyaudio
from piper import PiperVoice

from gtw.config import get_settings
from gtw.speech import load_piper_voice, load_whisper, pcm16_to_float

QUESTION = "Hej! Hur mår du idag jämfört med igår, bättre, samma eller sämre?"
MIC_RATE = 16000


def speak(audio: pyaudio.PyAudio, voice: PiperVoice, text: str) -> None:
    chunks = list(voice.synthesize(text))
    stream = audio.open(format=pyaudio.paInt16, channels=1, rate=chunks[0].sample_rate, output=True)
    for chunk in chunks:
        stream.write(chunk.audio_int16_bytes)
    stream.close()


def record(audio: pyaudio.PyAudio, seconds: float) -> np.ndarray:
    stream = audio.open(format=pyaudio.paInt16, channels=1, rate=MIC_RATE, input=True, frames_per_buffer=1024)
    frames = [stream.read(1024) for _ in range(int(MIC_RATE / 1024 * seconds))]
    stream.close()
    return pcm16_to_float(b"".join(frames))


def main() -> None:
    settings = get_settings()
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=float, default=5)
    parser.add_argument("--voice", default=settings.piper_voice)
    args = parser.parse_args()

    model = load_whisper(settings)
    voice = load_piper_voice(settings, args.voice)
    audio = pyaudio.PyAudio()
    try:
        print(f"Speaking with {args.voice}: {QUESTION}")
        speak(audio, voice, QUESTION)
        print(f"Recording {args.seconds:.0f} s, answer in Swedish now...")
        recording = record(audio, args.seconds)
    finally:
        audio.terminate()

    started = time.perf_counter()
    segments, _ = model.transcribe(recording, language="sv")
    text = " ".join(segment.text.strip() for segment in segments)
    print(f"Heard ({(time.perf_counter() - started) * 1000:.0f} ms): {text or '(nothing)'}")


if __name__ == "__main__":
    main()
