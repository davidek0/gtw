from dataclasses import replace

import pytest

from gtw import controller
from gtw.fields import FIELDS
from gtw.state import CheckinState, FieldUpdate, Patient


@pytest.fixture
def state() -> CheckinState:
    return CheckinState.new(Patient(id="p1", name="Karin"))


def answer(field: str, value, evidence: str = "...") -> FieldUpdate:
    return FieldUpdate(field=field, status="answered", value=value, evidence=evidence)


def ask(state: CheckinState, *updates: FieldUpdate) -> None:
    """Simulate asking the next field and receiving a turn with these updates."""
    state.target = controller.next_field(state).name
    controller.register_turn(state, list(updates))


def test_fields_are_asked_in_order(state):
    asked = []
    while (field := controller.next_field(state)) is not None:
        asked.append(field.name)
        value = {
            "respondent": "patient",
            "trend": "same",
            "breathing": "same",
            "confusion": False,
            "intake": "normal",
            "mobility": {"fell": False, "more_help": False},
            "pain": {"new_or_worse": False, "score_0_10": None},
            "medications": "taken",
            "other": None,
        }[field.name]
        ask(state, answer(field.name, value))
    assert asked == [spec.name for spec in FIELDS]
    assert controller.next_field(state) is None


def test_out_of_order_answers_are_not_asked_again(state):
    ask(state, answer("respondent", "proxy"))
    ask(state, answer("confusion", True), answer("intake", "less"))

    assert state.fields["trend"].attempts == 1
    assert state.fields["confusion"].status == "complete"
    assert controller.next_field(state).name == "trend"

    ask(state, answer("trend", "worse"))
    ask(state, answer("breathing", "same"))
    assert controller.next_field(state).name == "mobility"


def test_two_unanswered_attempts_mark_field_unclear(state):
    ask(state, answer("respondent", "patient"))
    ask(state)
    assert state.fields["trend"].status == "empty"
    assert controller.next_field(state).name == "trend"

    ask(state)
    assert state.fields["trend"].status == "unclear"
    assert state.fields["trend"].attempts == controller.MAX_ATTEMPTS
    assert controller.next_field(state).name == "breathing"


def test_declined_field_moves_on(state):
    ask(state, answer("respondent", "patient"))
    ask(state, FieldUpdate(field="trend", status="declined"))
    assert state.fields["trend"].status == "declined"
    assert controller.next_field(state).name == "breathing"


def test_patient_with_new_pain_is_asked_for_score(state):
    state.fields["respondent"].value = "patient"
    state.target = "pain"
    controller.register_turn(state, [answer("pain", {"new_or_worse": True, "score_0_10": None})])
    assert state.fields["pain"].status == "partial"

    controller.register_turn(state, [answer("pain", {"new_or_worse": None, "score_0_10": 6})])
    assert state.fields["pain"].status == "complete"
    assert state.fields["pain"].value == {"new_or_worse": True, "score_0_10": 6}


def test_proxy_is_not_asked_for_pain_score(state):
    state.fields["respondent"].value = "proxy"
    controller.apply_update(state, answer("pain", {"new_or_worse": True, "score_0_10": None}))
    assert state.fields["pain"].status == "complete"


def test_partial_field_stops_being_asked_after_attempt_cap(state):
    state.fields["respondent"].value = "patient"
    state.target = "mobility"
    controller.register_turn(state, [answer("mobility", {"fell": True, "more_help": None})])
    controller.register_turn(state, [])
    assert state.fields["mobility"].status == "partial"
    assert not controller.is_open(state.fields["mobility"])


def test_mobility_parts_merge_with_evidence(state):
    controller.apply_update(state, answer("mobility", {"fell": True, "more_help": None}, "jag ramlade"))
    controller.apply_update(state, answer("mobility", {"fell": None, "more_help": False}, "klarar mig själv"))
    assert state.fields["mobility"].value == {"fell": True, "more_help": False}
    assert state.fields["mobility"].evidence == "jag ramlade / klarar mig själv"


def test_fields_whose_condition_fails_are_skipped(state, monkeypatch):
    module_field = replace(FIELDS[1], name="weight_kg", condition=lambda s: "heart_failure" in s.patient.modules)
    monkeypatch.setattr(controller, "FIELDS", [FIELDS[0], module_field, *FIELDS[1:]])
    state.fields["weight_kg"] = state.fields["trend"].model_copy(update={"field": "weight_kg"})

    ask(state, answer("respondent", "patient"))
    assert controller.next_field(state).name == "trend"

    state.patient.modules.append("heart_failure")
    assert controller.next_field(state).name == "weight_kg"


def test_would_change_ignores_repeated_values(state):
    controller.apply_update(state, answer("trend", "same"))
    assert not controller.would_change(state, answer("trend", "same"))
    assert controller.would_change(state, answer("trend", "worse"))
    assert controller.would_change(state, answer("other", None))
