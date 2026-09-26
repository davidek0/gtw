from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from gtw.fields import FIELDS

FieldStatus = Literal["complete", "partial", "declined", "unclear", "empty"]
CheckinStatus = Literal["completed", "partial", "missed", "red_flag"]


def utcnow() -> datetime:
    return datetime.now(UTC)


class Patient(BaseModel):
    id: str
    name: str
    modules: list[str] = Field(default_factory=list)


class FieldState(BaseModel):
    field: str
    value: Any = None
    status: FieldStatus = "empty"
    evidence: str | None = None
    attempts: int = 0


class FieldUpdate(BaseModel):
    """One extracted answer. Values are already validated against the field's schema."""

    field: str
    status: Literal["answered", "declined"]
    value: Any = None
    evidence: str | None = None


class Turn(BaseModel):
    role: Literal["assistant", "user"]
    text: str
    ts: datetime = Field(default_factory=utcnow)


class CheckinState(BaseModel):
    patient: Patient
    fields: dict[str, FieldState]
    transcript: list[Turn] = Field(default_factory=list)
    target: str | None = None

    @classmethod
    def new(cls, patient: Patient) -> "CheckinState":
        return cls(patient=patient, fields={spec.name: FieldState(field=spec.name) for spec in FIELDS})

    @property
    def respondent(self) -> Literal["patient", "proxy", "unknown"]:
        return self.fields["respondent"].value or "unknown"

    def recent_transcript(self, turns: int = 6) -> list[Turn]:
        return self.transcript[-turns:]
