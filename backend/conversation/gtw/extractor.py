"""Turns free speech into validated field updates. The LLM proposes, this module validates."""

import json
import logging
import re
from typing import Any, Literal, get_args

from pydantic import BaseModel, ValidationError

from gtw.fields import FieldSpec
from gtw.llm import ChatLLM, Messages
from gtw.state import CheckinState, FieldUpdate

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """You extract structured answers from a Swedish health check-in conversation \
with an elderly patient or their proxy (a relative or home-care worker).

Read the latest user utterance, using the recent conversation for context. \
For every listed field that the utterance answers, output an update. People often answer \
several questions at once or out of order: capture all of them, not just the one that was asked.

Rules:
- Only output fields from the list. Only output values in the given format.
- If the person clearly does not want to answer a question, output status "declined" with value null.
- If the answer is vague or you are unsure, output nothing for that field. Never guess.
- For object fields, set parts that were not mentioned to null.
- A short answer like "ja" or "nej" answers the question the assistant just asked. A plain "nej" \
to a question that asks about several things ("have you fallen, or had more trouble getting around?") \
means no to all of them.
- If the person says there is nothing more to add, answer the field "other" with value null.
- "evidence" is the exact words from the utterance that support the value.
- "intent" says what the utterance is, besides any answers in it:
  "stop": the person wants to end the conversation now.
  "repeat": they did not hear or understand what the assistant just said and want it again \
(e.g. "vad sa du?", "jag hörde inte", "kan du ta det igen?", "hur menar du?").
  "question": they ask the assistant something instead of answering (e.g. about their health or medicines).
  "answer": anything else, including vague answers.
- Set "confirmed" to true or false only if the assistant just read back a summary and the person \
confirms it (true) or says it is wrong (false). Otherwise null.

Answer with JSON only:
{"updates": [{"field": "...", "status": "answered" | "declined", "value": ..., "evidence": "..."}], \
"intent": "answer", "confirmed": null}"""


Intent = Literal["answer", "repeat", "question", "stop"]


class ExtractionResult(BaseModel):
    updates: list[FieldUpdate] = []
    intent: Intent = "answer"
    confirmed: bool | None = None


def _field_lines(fields: list[FieldSpec]) -> str:
    return "\n".join(f"- {spec.name}: {spec.description} Value: {spec.value_hint}" for spec in fields)


def build_messages(text: str, fields: list[FieldSpec], state: CheckinState) -> Messages:
    history = "\n".join(f"{turn.role}: {turn.text}" for turn in state.recent_transcript())
    user = (
        f"Patient: {state.patient.name}. Respondent so far: {state.respondent}.\n\n"
        f"Fields:\n{_field_lines(fields)}\n\n"
        f"Recent conversation:\n{history}\n\n"
        f"Latest user utterance:\n{text}"
    )
    return [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user}]


def parse_json(raw: str) -> dict[str, Any] | None:
    """Parse a JSON object, tolerating code fences or text around it."""
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _validate_update(raw: Any, allowed: dict[str, FieldSpec]) -> FieldUpdate | None:
    if not isinstance(raw, dict) or (spec := allowed.get(raw.get("field"))) is None:
        return None
    status, evidence = raw.get("status", "answered"), raw.get("evidence")
    evidence = (evidence.strip() or None) if isinstance(evidence, str) else None
    if status == "declined":
        return FieldUpdate(field=spec.name, status="declined", evidence=evidence)
    if status != "answered":
        return None
    try:
        value = spec.adapter.dump_python(spec.adapter.validate_python(raw.get("value"), strict=True), mode="json")
    except ValidationError:
        return None
    if isinstance(value, dict) and all(part is None for part in value.values()):
        return None
    return FieldUpdate(field=spec.name, status="answered", value=value, evidence=evidence)


def validate(data: dict[str, Any] | None, fields: list[FieldSpec]) -> ExtractionResult:
    """Keep only well-formed updates for the given fields. Invalid ones are dropped, not repaired."""
    if not data:
        return ExtractionResult()
    allowed = {spec.name: spec for spec in fields}
    raw_updates = data.get("updates")
    raw_updates = raw_updates if isinstance(raw_updates, list) else []
    updates = [update for raw in raw_updates if (update := _validate_update(raw, allowed))]
    if dropped := len(raw_updates) - len(updates):
        log.info("Dropped %d invalid extractor update(s)", dropped)
    intent, confirmed = data.get("intent"), data.get("confirmed")
    return ExtractionResult(
        updates=updates,
        intent=intent if intent in get_args(Intent) else "answer",
        confirmed=confirmed if isinstance(confirmed, bool) else None,
    )


async def extract(llm: ChatLLM, text: str, fields: list[FieldSpec], state: CheckinState) -> ExtractionResult:
    raw = await llm.complete(build_messages(text, fields, state))
    return validate(parse_json(raw), fields)
