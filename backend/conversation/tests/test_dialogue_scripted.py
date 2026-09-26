import asyncio

from gtw import prompts, red_flags
from gtw.dialogue import up_to_first_question
from gtw.fields import FIELDS
from gtw.llm import LLMError
from tests.helpers import answered, asked, declined, extraction

FIELD_STATUSES = {"complete", "partial", "declined", "unclear", "empty"}

PROXY_DETERIORATION = [
    ("Hej, det är Anna, hennes dotter.", extraction(answered("respondent", "proxy", "hennes dotter"))),
    (
        "Hon verkar mer förvirrad idag och har knappt druckit något.",
        extraction(answered("confusion", True, "mer förvirrad"), answered("intake", "less", "knappt druckit")),
    ),
    ("Ja, sämre än igår faktiskt.", extraction(answered("trend", "worse", "sämre än igår"))),
    ("Nej, andningen är som vanligt.", extraction(answered("breathing", "same", "som vanligt"))),
    (
        "Nej, hon har inte ramlat och klarar sig.",
        extraction(answered("mobility", {"fell": False, "more_help": False}, "inte ramlat och klarar sig")),
    ),
    (
        "Nej, inte vad jag märkt.",
        extraction(answered("pain", {"new_or_worse": False, "score_0_10": None}, "inte vad jag märkt")),
    ),
    ("Ja, jag gav henne dem i morse.", extraction(answered("medications", "taken", "jag gav henne dem i morse"))),
    ("Nej, inget mer.", extraction(answered("other", None, "inget mer"))),
    ("Ja, det stämmer.", extraction(confirmed=True)),
]


def rows(store, dialogue) -> dict:
    checkin = store.get_checkin(dialogue.checkin_id)
    checkin["fields"] = {row["field"]: row for row in checkin["fields"]}
    return checkin


def assert_contract(checkin: dict) -> None:
    assert checkin["ended_at"] is not None
    assert checkin["status"] in {"completed", "partial", "missed", "red_flag"}
    assert checkin["respondent"] in {"patient", "proxy", "unknown"}
    assert set(checkin["fields"]) == {spec.name for spec in FIELDS}
    assert all(row["status"] in FIELD_STATUSES for row in checkin["fields"].values())


def test_proxy_answering_several_fields_at_once(run_script):
    dialogue, store, llm, _ = run_script(PROXY_DETERIORATION)
    checkin = rows(store, dialogue)

    assert dialogue.outcome == "completed"
    assert_contract(checkin)
    assert checkin["respondent"] == "proxy"
    assert checkin["fields"]["confusion"]["value"] is True
    assert checkin["fields"]["intake"]["value"] == "less"
    assert checkin["fields"]["intake"]["evidence"] == "knappt druckit"
    assert "confusion" not in asked(dialogue) and "intake" not in asked(dialogue)
    assert checkin["summary"] == (
        "Så Karin mår sämre än igår, är tröttare eller mer förvirrad och har ätit eller druckit mindre, "
        "men annars är allt som vanligt."
    )
    assert store.device_states["p-karin"][-1] == "idle"


def test_red_flag_ends_with_fixed_script_and_alert(run_script):
    dialogue, store, _, extractor = run_script([("Han har ont i bröstet.", None)])
    checkin = rows(store, dialogue)

    assert dialogue.outcome == "red_flag"
    assert extractor.calls == 0
    assert dialogue.state.transcript[-1].text == red_flags.RED_FLAG_SCRIPT
    assert [alert["kind"] for alert in checkin["alerts"]] == ["red_flag"]
    assert store.device_states["p-karin"] == ["alert", "idle"]
    assert checkin["summary"] is None
    assert_contract(checkin)


def test_red_flag_keeps_fields_collected_so_far(run_script):
    dialogue, store, _, _ = run_script(
        [
            ("Det är jag.", extraction(answered("respondent", "patient"))),
            ("Jag slog i huvudet i natt.", None),
        ]
    )
    checkin = rows(store, dialogue)
    assert checkin["status"] == "red_flag"
    assert checkin["fields"]["respondent"]["value"] == "patient"


def test_declined_question_is_skipped(run_script):
    dialogue, _, _, _ = run_script(
        [
            ("Ja, det är jag.", extraction(answered("respondent", "patient"))),
            ("Det vill jag inte prata om.", extraction(declined("trend"))),
            ("Nej.", extraction(answered("breathing", "same"))),
        ]
    )
    assert dialogue.state.fields["trend"].status == "declined"
    assert asked(dialogue) == ["trend", "breathing", "confusion"]


def test_two_unclear_answers_move_on(run_script):
    dialogue, _, _, _ = run_script(
        [
            ("Ja, det är jag.", extraction(answered("respondent", "patient"))),
            ("Tja, vad ska man säga.", extraction()),
            ("Det beror på vädret.", extraction()),
        ]
    )
    assert dialogue.state.fields["trend"].status == "unclear"
    assert asked(dialogue) == ["trend", "trend", "breathing"]


def test_readback_correction_reads_back_once_more(run_script):
    turns = PROXY_DETERIORATION[:-1] + [
        ("Nej, hon har faktiskt ramlat.", extraction(answered("mobility", {"fell": True, "more_help": None}))),
        ("Ja.", extraction(confirmed=True)),
    ]
    dialogue, store, _, _ = run_script(turns)
    readbacks = [turn.text for turn in dialogue.state.transcript if turn.text.endswith(prompts.CONFIRM)]

    assert len(readbacks) == 2
    assert "har ramlat" in readbacks[1]
    assert dialogue.outcome == "completed"
    assert rows(store, dialogue)["fields"]["mobility"]["value"] == {"fell": True, "more_help": False}


def test_nobody_answering_is_saved_as_missed(run_script):
    dialogue, store, _, _ = run_script([(None, None), (None, None)])
    checkin = rows(store, dialogue)

    assert dialogue.outcome == "missed"
    assert [alert["kind"] for alert in checkin["alerts"]] == ["missed_checkin"]
    assert checkin["respondent"] == "unknown"
    assert_contract(checkin)


def test_wanting_to_stop_ends_as_partial(run_script):
    dialogue, _, _, _ = run_script([("Nej, inte nu, jag orkar inte.", extraction(intent="stop"))])
    assert dialogue.outcome == "partial"
    assert dialogue.state.transcript[-1].text == prompts.STOP_GOODBYE


def test_llm_failure_degrades_to_partial(run_script):
    dialogue, store, _, _ = run_script([("Ja, det är jag.", LLMError("all brokers down"))])
    assert dialogue.outcome == "partial"
    assert dialogue.state.transcript[-1].text == prompts.TECHNICAL_PROBLEM
    assert_contract(rows(store, dialogue))


def test_reply_stops_after_the_first_question():
    async def chunks():
        for chunk in ["Okej, tack. Hur mår", " hon idag? Är hon", " sämre? Det låter så."]:
            yield chunk

    async def collect():
        return "".join([chunk async for chunk in up_to_first_question(chunks())])

    assert asyncio.run(collect()) == "Okej, tack. Hur mår hon idag?"


def test_every_reply_starts_with_a_varying_acknowledgement(run_script):
    dialogue, _, _, _ = run_script(PROXY_DETERIORATION[:4])
    turns = dialogue.state.transcript
    acknowledgements = [turns[i + 1].text for i, turn in enumerate(turns[:-1]) if turn.role == "user"]

    assert acknowledgements == [prompts.acknowledgement(n) for n in range(1, 5)]
    assert all(a != b for a, b in zip(acknowledgements, acknowledgements[1:], strict=False))


def test_repeat_request_repeats_the_question_without_charging_an_attempt(run_script):
    dialogue, _, _, _ = run_script(
        [
            ("Ja, det är jag.", extraction(answered("respondent", "patient"))),
            ("Jag hörde inte vad du sa.", extraction(intent="repeat")),
            ("Samma som igår.", extraction(answered("trend", "same"))),
        ]
    )
    assert prompts.repeat("Fråga om trend?") in [turn.text for turn in dialogue.state.transcript]
    assert dialogue.state.fields["trend"].attempts == 1
    assert asked(dialogue) == ["trend", "trend", "breathing"]


def test_repeat_request_during_readback_reads_the_summary_again(run_script):
    turns = PROXY_DETERIORATION[:-1] + [
        ("Vad sa du?", extraction(intent="repeat")),
        ("Ja, det stämmer.", extraction(confirmed=True)),
    ]
    dialogue, _, _, _ = run_script(turns)

    assert prompts.repeat(prompts.readback(dialogue.state)) in [turn.text for turn in dialogue.state.transcript]
    assert dialogue.outcome == "completed"


def test_question_to_the_assistant_is_answered_and_the_field_asked_again(run_script):
    dialogue, _, _, _ = run_script(
        [
            ("Ja, det är jag.", extraction(answered("respondent", "patient"))),
            ("Ska jag ta en extra tablett?", extraction(intent="question")),
            ("Nej, samma som igår.", extraction(answered("trend", "same"))),
        ]
    )
    assert dialogue.state.fields["trend"].attempts == 1
    assert asked(dialogue) == ["trend", "trend", "breathing"]


def test_next_question_generated_during_extraction_is_reused(run_script):
    dialogue, _, llm, _ = run_script(PROXY_DETERIORATION)

    # Two guesses miss: the first answer sets the respondent, which changes the prompt, and the
    # second answers other fields but not trend. Every other question is the one generated early.
    assert asked(dialogue) == ["trend", "trend", "breathing", "mobility", "pain", "medications", "other"]
    assert llm.calls == len(asked(dialogue)) + 2
