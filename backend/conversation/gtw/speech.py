"""Local Swedish speech: KB-Whisper for STT, Piper for TTS, Silero VAD for turn-taking."""

import ctypes
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.services.piper.tts import PIPER_CACHE_DIR
from piper import PiperVoice
from piper.download_voices import download_voice

from gtw.config import Settings


def preload_cuda_libraries() -> None:
    """Load the CUDA 12 cuBLAS/cuDNN from the nvidia-* wheels so faster-whisper can find them.

    The system may have a different CUDA version; the wheels' libraries are not on the loader
    path, but once loaded by full path they are found by name. Their siblings resolve via RUNPATH.
    """
    try:
        import nvidia.cublas
        import nvidia.cudnn
    except ImportError:
        return
    for package, library in ((nvidia.cublas, "libcublas.so.12"), (nvidia.cudnn, "libcudnn.so.9")):
        ctypes.CDLL(str(Path(package.__path__[0]) / "lib" / library), mode=ctypes.RTLD_GLOBAL)


def load_whisper(settings: Settings) -> WhisperModel:
    preload_cuda_libraries()
    return WhisperModel(
        settings.whisper_model, device=settings.whisper_device, compute_type=settings.whisper_compute_type
    )


def load_piper_voice(settings: Settings, voice_id: str | None = None) -> PiperVoice:
    voice_id = voice_id or settings.piper_voice
    PIPER_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if not (PIPER_CACHE_DIR / f"{voice_id}.onnx").exists():
        download_voice(voice_id, PIPER_CACHE_DIR)
    voice = PiperVoice.load(PIPER_CACHE_DIR / f"{voice_id}.onnx")
    voice.config.length_scale = settings.piper_length_scale
    return voice


def vad_params(settings: Settings) -> VADParams:
    return VADParams(stop_secs=settings.end_of_turn_silence_s)


def pcm16_to_float(audio: bytes) -> np.ndarray:
    return np.frombuffer(audio, np.int16).astype(np.float32) / 32768
