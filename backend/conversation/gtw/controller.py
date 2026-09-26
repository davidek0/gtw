"""Deterministic check-in flow: which field to ask next and when a field is done."""

from typing import Any

from gtw.fields import FIELDS, FIELDS_BY_NAME, FieldSpec
from gtw.state import CheckinState, FieldState, FieldUpdate

MAX_ATTEMPTS = 2


def applicable_fields(state: CheckinState) -> list[FieldSpec]:
    return [spec for spec in FIELDS if spec.condition(state)]


def is_open(field: FieldState) -> bool:
    return field.status in ("empty", "partial") and field.attempts < MAX_ATTEMPTS


def open_fields(state: CheckinState) -> list[FieldSpec]:
    """Fields that can still receive an answer, including ones that ran out of attempts."""
    return [spec for spec in applicable_fields(state) if state.fields[spec.name].status not in ("complete", "declined")]


def next_field(state: CheckinState) -> FieldSpec | None:
    return next((spec for spec in applicable_fields(state) if is_open(state.fields[spec.name])), None)


def open_after(state: CheckinState, field: FieldSpec) -> int:
    """How many questions are still to be asked besides this one."""
    return sum(1 for spec in applicable_fields(state) if spec is not field and is_open(state.fields[spec.name]))


def _merge(old: Any, new: Any) -> Any:
    if isinstance(old, dict) and isinstance(new, dict):
        return old | {key: value for key, value in new.items() if value is not None}
    return new


def would_change(state: CheckinState, update: FieldUpdate) -> bool:
    field = state.fields[update.field]
    if update.status == "declined":
        return field.status != "declined"
    return field.status not in ("complete", "partial") or _merge(field.value, update.value) != field.value


def apply_update(state: CheckinState, update: FieldUpdate) -> None:
    field = state.fields[update.field]
    if update.status == "declined":
        field.value, field.status, field.evidence = None, "declined", update.evidence
        return

    merging = isinstance(field.value, dict)
    field.value = _merge(field.value, update.value)
    field.evidence = " / ".join(filter(None, [field.evidence, update.evidence])) if merging else update.evidence
    spec = FIELDS_BY_NAME[update.field]
    field.status = "complete" if spec.is_complete(field.value, state.respondent) else "partial"


def register_turn(state: CheckinState, updates: list[FieldUpdate]) -> None:
    """Apply a user turn's updates and charge one attempt to the field that was asked about."""
    for update in updates:
        apply_update(state, update)

    if state.target is None:
        return
    target = state.fields[state.target]
    target.attempts += 1
    if target.status == "empty" and target.attempts >= MAX_ATTEMPTS:
        target.status = "unclear"
