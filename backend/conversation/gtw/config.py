from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    supabase_url: str = ""
    supabase_service_key: str = ""

    llm_base_url: str = "http://localhost:4000"
    litellm_master_key: str = "sk-gtw-local"
    dialogue_model: str = "gtw"
    extraction_model: str = "gtw"
    extraction_json_mode: bool = True
    # Per-attempt timeouts live in litellm/config.yaml. These cover the whole fallback chain,
    # so a slow broker falls back instead of ending the check-in.
    dialogue_timeout_s: float = 12.0
    extraction_timeout_s: float = 15.0

    no_answer_timeout_s: float = 30.0

    whisper_model: str = "KBLab/kb-whisper-medium"
    whisper_device: str = "cuda"
    whisper_compute_type: str = "int8_float16"
    whisper_no_speech_prob: float = 0.4  # segments Whisper rates at or above this are dropped as noise
    piper_voice: str = "sv_SE-lisa-medium"
    piper_length_scale: float = 1.15  # slightly slower than the voice's default, for elderly listeners
    browser_whisper_model: str = "tiny.en"
    browser_piper_voice: str = "en_US-lessac-low"
    # Silence that ends a turn. Elderly speakers pause mid-sentence, so keep this generous.
    end_of_turn_silence_s: float = 1.2
    # Letting the user talk over the bot needs a headset or echo cancellation; with laptop
    # speakers the mic hears the bot and it would interrupt (and transcribe) itself.
    barge_in: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
