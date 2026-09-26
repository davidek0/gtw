"""Thin async client for the LiteLLM proxy. Every LLM call in the backend goes through here."""

import re
from collections.abc import AsyncIterator
from contextlib import aclosing
from typing import Protocol

import openai

Messages = list[dict[str, str]]

THINK_OPEN, THINK_CLOSE = "<think>", "</think>"
THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL)


class LLMError(Exception):
    """The proxy failed after all fallbacks, or timed out."""


class ChatLLM(Protocol):
    async def complete(self, messages: Messages) -> str: ...

    def stream(self, messages: Messages) -> AsyncIterator[str]: ...


async def strip_think(chunks: AsyncIterator[str]) -> AsyncIterator[str]:
    """Drop a leading <think>...</think> block that some reasoning models put in the content."""
    buffer = ""
    thinking: bool | None = None
    async with aclosing(chunks):
        async for chunk in chunks:
            if thinking is False:
                yield chunk
                continue
            buffer += chunk
            if thinking is None:
                head = buffer.lstrip()
                if len(head) < len(THINK_OPEN) and THINK_OPEN.startswith(head):
                    continue
                thinking = head.startswith(THINK_OPEN)
                if not thinking:
                    yield buffer
                    continue
            if (end := buffer.find(THINK_CLOSE)) != -1:
                thinking = False
                if rest := buffer[end + len(THINK_CLOSE) :].lstrip():
                    yield rest


class ProxyLLM:
    def __init__(self, base_url: str, api_key: str, *, model: str, timeout_s: float, json_mode: bool = False):
        self._client = openai.AsyncOpenAI(base_url=base_url, api_key=api_key, max_retries=0)
        self._model = model
        self._timeout_s = timeout_s
        self._json_mode = json_mode

    async def complete(self, messages: Messages) -> str:
        extra = {"response_format": {"type": "json_object"}} if self._json_mode else {}
        try:
            response = await self._client.chat.completions.create(
                model=self._model, messages=messages, temperature=0, timeout=self._timeout_s, **extra
            )
        except openai.APIError as error:
            raise LLMError(str(error)) from error
        return THINK_BLOCK.sub("", response.choices[0].message.content or "").strip()

    def stream(self, messages: Messages) -> AsyncIterator[str]:
        return strip_think(self._raw_stream(messages))

    async def _raw_stream(self, messages: Messages) -> AsyncIterator[str]:
        try:
            response = await self._client.chat.completions.create(
                model=self._model, messages=messages, temperature=0.4, timeout=self._timeout_s, stream=True
            )
            async with response:
                async for chunk in response:
                    if chunk.choices and (text := chunk.choices[0].delta.content):
                        yield text
        except openai.APIError as error:
            raise LLMError(str(error)) from error
