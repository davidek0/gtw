"""The check-in questions as data. Edit questions, order and conditions here only."""

from collections.abc import Callable
from dataclasses import dataclass
from functools import cached_property
from typing import TYPE_CHECKING, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

if TYPE_CHECKING:
    from gtw.state import CheckinState

Respondent = Literal["patient", "proxy"]
Change = Literal["better", "same", "worse"]


class Mobility(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fell: bool | None = None
    more_help: bool | None = None


class Pain(BaseModel):
    model_config = ConfigDict(extra="forbid")
    new_or_worse: bool | None = None
    score_0_10: int | None = Field(default=None, ge=0, le=10)


def _always(state: "CheckinState") -> bool:
    return True


def _answered(value: Any, respondent: str) -> bool:
    return True


def _mobility_complete(value: dict, respondent: str) -> bool:
    return value["fell"] is not None and value["more_help"] is not None


def _pain_complete(value: dict, respondent: str) -> bool:
    if value["new_or_worse"] is None:
        return False
    needs_score = value["new_or_worse"] and respondent == "patient"
    return not needs_score or value["score_0_10"] is not None


def _mobility_finding(value: dict) -> str | None:
    match value:
        case {"fell": True, "more_help": True}:
            return "har ramlat och behöver mer hjälp"
        case {"fell": True}:
            return "har ramlat"
        case {"more_help": True}:
            return "behöver mer hjälp att ta sig runt"
    return None


def _pain_finding(value: dict) -> str | None:
    if not value["new_or_worse"]:
        return None
    score = value["score_0_10"]
    return "har ny eller värre smärta" + (f", {score} av 10" if score is not None else "")


@dataclass(frozen=True)
class FieldSpec:
    name: str
    description: str
    value_schema: Any
    value_hint: str
    q_patient: str
    q_proxy: str
    condition: Callable[["CheckinState"], bool] = _always
    is_complete: Callable[[Any, str], bool] = _answered
    # Spoken clause for the readback when the answer differs from usual, None when it is as usual.
    finding: Callable[[Any], str | None] | None = None

    @cached_property
    def adapter(self) -> TypeAdapter:
        return TypeAdapter(self.value_schema)

    def question(self, respondent: str, name: str) -> str:
        template = self.q_proxy if respondent == "proxy" else self.q_patient
        return template.format(name=name)


FIELDS: list[FieldSpec] = [
    FieldSpec(
        name="respondent",
        description="Who is answering: the patient themself, or a proxy (relative or home-care worker).",
        value_schema=Respondent,
        value_hint='"patient" | "proxy"',
        q_patient="Är det {name} jag pratar med, eller någon annan?",
        q_proxy="Är det {name} jag pratar med, eller någon annan?",
    ),
    FieldSpec(
        name="trend",
        description="Overall condition today compared with yesterday.",
        value_schema=Change,
        value_hint='"better" | "same" | "worse"',
        q_patient="Hur mår du idag jämfört med igår – bättre, samma eller sämre?",
        finding={"better": "mår bättre än igår", "worse": "mår sämre än igår"}.get,
        q_proxy="Hur verkar {name} må idag jämfört med igår – bättre, samma eller sämre?",
    ),
    FieldSpec(
        name="breathing",
        description="Breathlessness compared with usual.",
        value_schema=Change,
        value_hint='"better" | "same" | "worse" (worse = more short of breath than usual)',
        q_patient="Har du varit mer andfådd än vanligt?",
        q_proxy="Andas {name} tyngre än vanligt?",
        finding={"better": "andas lättare", "worse": "är mer andfådd"}.get,
    ),
    FieldSpec(
        name="confusion",
        description="More tired, sleepy or confused than usual.",
        value_schema=bool,
        value_hint="true | false (true = more than usual)",
        q_patient="Har du känt dig tröttare eller mer virrig än vanligt?",
        q_proxy="Har {name} varit mer förvirrad eller sömnig än vanligt?",
        finding=lambda more: "är tröttare eller mer förvirrad" if more else None,
    ),
    FieldSpec(
        name="intake",
        description="Eating and drinking compared with usual.",
        value_schema=Literal["normal", "less"],
        value_hint='"normal" | "less"',
        q_patient="Har du ätit och druckit ungefär som vanligt?",
        q_proxy="Har {name} ätit eller druckit mindre än vanligt?",
        finding=lambda intake: "har ätit eller druckit mindre" if intake == "less" else None,
    ),
    FieldSpec(
        name="mobility",
        description="Has fallen, and/or needs more help than usual moving around or going to the toilet.",
        value_schema=Mobility,
        value_hint='{"fell": true | false | null, "more_help": true | false | null} (null = not mentioned)',
        q_patient="Har du ramlat, eller haft svårare att ta dig runt?",
        q_proxy="Har {name} ramlat eller behövt mer hjälp att röra sig eller gå på toaletten?",
        is_complete=_mobility_complete,
        finding=_mobility_finding,
    ),
    FieldSpec(
        name="pain",
        description=(
            "New pain or worse pain than before. If the patient themself has new or worse pain, "
            "also their pain score from 0 to 10. A proxy is not asked for a score."
        ),
        value_schema=Pain,
        value_hint='{"new_or_worse": true | false | null, "score_0_10": 0-10 | null}',
        q_patient="Har du någon ny smärta, eller värre än förut? Hur ont, från 0 till 10?",
        q_proxy="Verkar {name} ha ont?",
        is_complete=_pain_complete,
        finding=_pain_finding,
    ),
    FieldSpec(
        name="medications",
        description="Whether the usual medications have been taken.",
        value_schema=Literal["taken", "missed", "unsure"],
        value_hint='"taken" | "missed" | "unsure"',
        q_patient="Har du tagit dina mediciner som vanligt?",
        q_proxy="Har {name} tagit sina mediciner som vanligt?",
        finding={"missed": "har missat medicinerna", "unsure": "är osäker på medicinerna"}.get,
    ),
    FieldSpec(
        name="other",
        description="Anything else the nurse should know. null if there is nothing more.",
        value_schema=str | None,
        value_hint="short text in the speaker's words | null (nothing more)",
        q_patient="Är det något mer du vill att sjuksköterskan ska veta?",
        q_proxy="Är det något mer du vill att sjuksköterskan ska veta om {name}?",
    ),
]

FIELDS_BY_NAME: dict[str, FieldSpec] = {spec.name: spec for spec in FIELDS}
