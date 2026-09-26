from gtw.extractor import parse_json, validate
from gtw.fields import FIELDS, FIELDS_BY_NAME
from tests.helpers import answered, declined, extraction


def updates_for(*raw_updates: dict, fields=FIELDS):
    return validate(extraction(*raw_updates), fields).updates


def test_accepts_valid_updates_for_several_fields():
    updates = updates_for(answered("confusion", True, "mer förvirrad"), answered("intake", "less", "knappt druckit"))
    assert [(u.field, u.value) for u in updates] == [("confusion", True), ("intake", "less")]


def test_drops_values_outside_the_schema():
    assert updates_for(answered("intake", "mindre")) == []
    assert updates_for(answered("confusion", "true")) == []
    assert updates_for(answered("trend", None)) == []
    assert updates_for(answered("pain", {"new_or_worse": True, "score_0_10": 11})) == []
    assert updates_for(answered("mobility", {"fell": True, "unknown_part": 1})) == []


def test_drops_unknown_or_closed_fields():
    assert updates_for(answered("mood", "happy")) == []
    assert updates_for(answered("trend", "same"), fields=[FIELDS_BY_NAME["breathing"]]) == []


def test_drops_malformed_updates_but_keeps_valid_ones():
    data = {
        "updates": [
            "trend",
            {"status": "answered"},
            answered("breathing", "worse"),
            {**answered("trend", "same"), "status": "maybe"},
        ]
    }
    assert [u.field for u in validate(data, FIELDS).updates] == ["breathing"]


def test_drops_object_answers_with_no_information():
    assert updates_for(answered("mobility", {"fell": None, "more_help": None})) == []


def test_declined_needs_no_value():
    [update] = updates_for(declined("trend"))
    assert update.status == "declined"
    assert update.value is None


def test_blank_evidence_becomes_null():
    [update] = updates_for(answered("trend", "same", "  "))
    assert update.evidence is None


def test_other_may_be_answered_with_nothing():
    [update] = updates_for(answered("other", None))
    assert update.value is None


def test_reads_intent_and_confirmation():
    result = validate(extraction(intent="repeat", confirmed=True), FIELDS)
    assert result.intent == "repeat" and result.confirmed is True
    result = validate({"updates": [], "intent": "leave", "confirmed": "ja"}, FIELDS)
    assert result.intent == "answer" and result.confirmed is None


def test_invalid_json_gives_empty_result():
    assert validate(parse_json("I think the answer is yes"), FIELDS).updates == []
    assert validate(parse_json('{"updates": [broken'), FIELDS).updates == []


def test_parse_json_tolerates_code_fences():
    assert parse_json('```json\n{"updates": []}\n```') == {"updates": []}
