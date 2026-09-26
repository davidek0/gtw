"""Everything the agent says: fixed lines, the dialogue prompt, and the readback summary."""

import json

from gtw import controller
from gtw.controller import MAX_ATTEMPTS, applicable_fields
from gtw.fields import FieldSpec
from gtw.llm import Messages
from gtw.state import CheckinState

GOODBYE = "Tack för att du tog dig tid. Jag skickar det här till sjuksköterskan. Ha en fin dag!"
STOP_GOODBYE = "Okej, då slutar vi här. Vårdpersonalen hör av sig om det behövs. Ha det bra!"
TECHNICAL_PROBLEM = "Jag har lite tekniska problem, vårdpersonalen hör av sig."
NO_ANSWER = "Jag hör inget svar. Vårdpersonalen hör av sig. Hej då."
ASK_CORRECTION = "Förlåt. Vad är det som inte stämmer?"
CONFIRM = "Stämmer det?"

# Said the moment the person stops talking, while the reply is worked out. Rotated so it never repeats.
ACKNOWLEDGEMENTS = ["Okej.", "Jag förstår.", "Ja, okej."]

RULES = """Regler:
- Tala svenska, varmt och lugnt, med korta meningar.
- Du har redan sagt en kort kvittens (se samtalet), så börja inte med "Okej", "Ja", "Tack" eller "Jag förstår".
- Om svaret handlade om något som blivit sämre eller är jobbigt, visa kort medkänsla, till exempel \
"Oj, vad tråkigt att höra." eller "Det låter jobbigt." Om något var bra passar "Vad skönt." \
Annars går du direkt på frågan.
- Ställ sedan exakt en fråga, om ämnet under "Fråga nu om". Byt inte ämne och hoppa inte vidare, \
även om du tror att det redan är besvarat.
- Formulera frågan med egna, vardagliga ord, som i ett vanligt samtal. Säg inte namnet i varje fråga: \
har du sagt det i någon av dina senaste repliker, så låt bli.
- Visa medkänsla, men tolka eller bedöm aldrig vad svaren betyder. Ge aldrig medicinska råd eller diagnoser.
- Skriv bara det som ska sägas högt. Ingen markdown, inga listor, inga emojis."""

ANSWER_QUESTION = """Personen ställde nyss en fråga i stället för att svara. Svara kort och vänligt på den. \
Gäller den hälsa, mediciner eller behandling, säg att sjuksköterskan eller läkaren följer upp det. \
Ställ sedan frågan ovan igen. Ställ inga andra frågor."""


def greeting(name: str) -> str:
    return f"God morgon {name}, har du en stund att prata?"


def acknowledgement(turn: int) -> str:
    return ACKNOWLEDGEMENTS[turn % len(ACKNOWLEDGEMENTS)]


def retry(last_utterance: str) -> str:
    return f"Hallå, hör du mig? {last_utterance}"


def repeat(question: str) -> str:
    return f"Jag tar det igen. {question}"


def _who(state: CheckinState) -> str:
    name = state.patient.name
    if state.respondent == "patient":
        return f"{name} själv. Säg du till {name}."
    if state.respondent == "proxy":
        return f"en närstående eller vårdare till {name}. Prata om {name} i tredje person."
    return f"någon i {name}s hem. Ni vet ännu inte om det är {name} själv."


def _target_lines(state: CheckinState, field: FieldSpec) -> list[str]:
    current = state.fields[field.name]
    lines = [
        f"Fråga nu om: {field.name} ({field.description})",
        f'Det här vill du veta, formulerat fritt: "{field.question(state.respondent, state.patient.name)}"',
    ]
    if current.status == "partial":
        lines.append(f"Redan känt: {json.dumps(current.value, ensure_ascii=False)}. Fråga bara om det som saknas.")
    if 0 < current.attempts < MAX_ATTEMPTS:
        lines.append("Förra svaret gick inte att tolka säkert. Fråga igen, enklare, gärna med svarsalternativ.")
    remaining = controller.open_after(state, field)
    if remaining == 0:
        lines.append("Det här är sista frågan. Säg gärna det kort.")
    elif remaining == 2:
        lines.append("Efter den här är det bara två frågor kvar. Säg gärna det kort.")
    return lines


def dialogue_messages(state: CheckinState, field: FieldSpec, *, answer_question: bool = False) -> Messages:
    """Ask for one line about a field code has chosen.

    The history goes in as quoted text rather than chat turns: given chat turns, the model
    tends to run the check-in itself and ask about fields it never asked aloud.
    """
    system = "\n\n".join(
        [
            "Du är en röstassistent som gör en kort daglig hälsokontroll för hemsjukvården. "
            "Du samlar bara in information.",
            f"Du pratar med {_who(state)}",
            RULES,
        ]
    )
    speaker = {"assistant": "Du", "user": "Personen"}
    history = "\n".join(f"{speaker[turn.role]}: {turn.text}" for turn in state.recent_transcript())
    task = _target_lines(state, field)
    if answer_question:
        task.append(ANSWER_QUESTION)
    user = f"Samtalet hittills:\n{history}\n\n{'\n'.join(task)}\n\nSkriv din nästa replik."
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def summary(state: CheckinState) -> str:
    """Only what differs from usual, so the readback stays short enough to follow by ear."""
    answered = [
        (spec, state.fields[spec.name].value)
        for spec in applicable_fields(state)
        if spec.finding and state.fields[spec.name].status in ("complete", "partial")
    ]
    findings = [clause for spec, value in answered if (clause := spec.finding(value))]
    subject = state.patient.name if state.respondent == "proxy" else "du"

    if not findings:
        text = "Så allt är ungefär som vanligt idag."
    else:
        listed = findings[0] if len(findings) == 1 else f"{', '.join(findings[:-1])} och {findings[-1]}"
        rest = ", men annars är allt som vanligt" if len(answered) > len(findings) else ""
        text = f"Så {subject} {listed}{rest}."
    if other := state.fields["other"].value:
        text += f" Och du vill att sjuksköterskan ska veta: {other.rstrip('.!? ')}."
    return text


def readback(state: CheckinState) -> str:
    return f"{summary(state)} {CONFIRM}"
