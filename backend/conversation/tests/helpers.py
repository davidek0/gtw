"""Stub LLMs and builders for extractor replies."""

import asyncio
import json
import re
from collections.abc import AsyncIterator

from gtw.dialogue import Dialogue


class ScriptedExtractor:
    """Returns one canned extraction per call, in order. An exception instance is raised instead."""

    def __init__(self, replies: list[dict | Exception]):
        self.replies = list(replies)
        self.calls = 0

    async def complete(self, messages) -> str:
        await asyncio.sleep(0)  # a real extraction is I/O, which lets concurrent work run
        reply = self.replies[self.calls]
        self.calls += 1
        if isinstance(reply, Exception):
            raise reply
        return json.dumps(reply)


class EchoDialogueLLM:
    """Asks about whichever field the prompt names: "Fråga om trend?"."""

    def __init__(self):
        self.calls = 0

    async def stream(self, messages) -> AsyncIterator[str]:
        self.calls += 1
        target = messages[-1]["content"].split("Fråga nu om: ")[1].split(" ")[0]
        for chunk in ["Fråga om ", f"{target}?"]:
            yield chunk


def asked(dialogue: Dialogue) -> list[str]:
    """The fields the dialogue asked about, in order, including repeats."""
    return [m for turn in dialogue.state.transcript for m in re.findall(r"Fråga om (\w+)\?", turn.text)]


def answered(field: str, value, evidence: str = "") -> dict:
    return {"field": field, "status": "answered", "value": value, "evidence": evidence}


def declined(field: str) -> dict:
    return {"field": field, "status": "declined", "value": None, "evidence": ""}


def extraction(*updates: dict, intent: str = "answer", confirmed: bool | None = None) -> dict:
    return {"updates": list(updates), "intent": intent, "confirmed": confirmed}
