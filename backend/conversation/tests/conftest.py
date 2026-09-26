import asyncio

import pytest

from gtw.db import MemoryStore
from gtw.dialogue import Dialogue
from gtw.state import Patient
from tests.helpers import EchoDialogueLLM, ScriptedExtractor


@pytest.fixture
def karin() -> Patient:
    return Patient(id="p-karin", name="Karin")


@pytest.fixture
def run_script(karin):
    """Run a scripted conversation: a list of (user text, extractor reply) pairs. None text = silence."""

    async def run_async(turns: list[tuple[str | None, dict | Exception | None]]):
        store = MemoryStore([karin])
        extractor = ScriptedExtractor([reply for _, reply in turns if reply is not None])
        llm = EchoDialogueLLM()
        dialogue = Dialogue(karin, dialogue_llm=llm, extraction_llm=extractor, store=store)
        await dialogue.start()
        for text, _ in turns:
            if dialogue.ended:
                break
            if text is None:
                await dialogue.handle_silence()
            else:
                async for _ in dialogue.handle(text):
                    pass
        await dialogue.close()
        return dialogue, store, llm, extractor

    return lambda turns: asyncio.run(run_async(turns))
