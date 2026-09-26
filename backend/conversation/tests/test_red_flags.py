import pytest

from gtw import red_flags

RED_FLAGS = [
    "Han har ont i bröstet.",
    "Jag har ONT I BRÖSTET!",
    "Det känns som ett tryck över bröstet",
    "Hon har haft bröstsmärtor sedan i morse",
    "Jag får ingen luft",
    "Jag kan inte andas",
    "Han slog i huvudet när han föll",
    "Jag kommer inte upp ur sängen",
    "Jag kan inte resa mig",
    "Hon kan inte resa sig från stolen",
    "Han sluddrar när han pratar",
    "Hon är sned i ansiktet",
    "Jag vill inte leva längre",
    "Ibland vill jag dö",
    "Jag tänker ta mitt liv",
]

STT_NEAR_MISSES = [
    "han har ont i brösted",
    "ont i bröstett",
    "hon har bröstsmärtan",
    "jag får ingen lluft",
    "jag kan inte andass",
    "han slog i huvvudet",
    "hon är sned i ansikte",
]

SAFE = [
    "Vill du ha kaffe?",
    "Jag vill inte äta så mycket idag",
    "Jag kan inte sova på nätterna",
    "Jag har ont i ryggen",
    "Jag kommer inte ihåg",
    "Nej, jag mår bra",
    "Han vill inte prata om det",
    "Jag har tagit mina mediciner",
    "Hon har druckit mindre än vanligt",
]


@pytest.mark.parametrize("text", RED_FLAGS + STT_NEAR_MISSES)
def test_detects_red_flags(text):
    assert red_flags.check(text) is not None


@pytest.mark.parametrize("text", SAFE)
def test_ignores_ordinary_answers(text):
    assert red_flags.check(text) is None


def test_hit_reports_the_matched_phrase():
    hit = red_flags.check("Han har ont i brösted")
    assert hit.phrase == "ont i bröstet"
    assert hit.matched_text == "ont i brösted"
