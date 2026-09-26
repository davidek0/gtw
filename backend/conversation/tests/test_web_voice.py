import asyncio

import pytest

from gtw.llm import LLMError
from gtw.web_voice import MISSED_SUMMARY, BrowserDialogue, summarize


class SummaryLLM:
    """Records each prompt and returns a fixed summary, or raises the given exception."""

    def __init__(self, reply: str | Exception = "Karin mår bra idag."):
        self.reply = reply
        self.prompts = []

    async def complete(self, messages) -> str:
        self.prompts.append(messages)
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply


def run_call(patient, utterances: list[str], llm: SummaryLLM) -> tuple[BrowserDialogue, dict]:
    async def run_async():
        dialogue = BrowserDialogue(patient)
        await dialogue.start()
        for text in utterances:
            async for _ in dialogue.handle(text):
                pass
        return dialogue, await summarize(dialogue, llm)

    return asyncio.run(run_async())


def test_answer_is_completed_with_the_llm_summary(karin):
    llm = SummaryLLM()
    dialogue, result = run_call(karin, ["Jag mår bra idag."], llm)

    assert not dialogue.ended
    assert len(llm.prompts) == 1
    assert '"patienten"' in llm.prompts[0][0]["content"]
    assert result.keys() == {"summary", "status", "endedAt"}
    assert result["status"] == "completed"
    assert result["summary"] == "Karin mår bra idag."


@pytest.mark.parametrize("utterances", [[], ["  "]])
def test_no_answer_is_missed_without_calling_the_llm(karin, utterances):
    llm = SummaryLLM()
    _, result = run_call(karin, utterances, llm)

    assert llm.prompts == []
    assert result["status"] == "missed"
    assert result["summary"] == MISSED_SUMMARY


def test_llm_failure_raises(karin):
    with pytest.raises(LLMError):
        run_call(karin, ["Jag mår bra."], SummaryLLM(LLMError("proxy down")))
