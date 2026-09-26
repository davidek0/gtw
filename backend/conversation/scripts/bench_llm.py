"""Benchmark each broker x model: streaming latency, JSON mode, tool calling and Swedish extraction.

uv run python scripts/bench_llm.py          # every BROKER_<NAME>_API_BASE/_API_KEY pair in .env
uv run python scripts/bench_llm.py --proxy  # the LiteLLM proxy's "gtw" model
"""

import argparse
import asyncio
import json
import statistics
import time
from dataclasses import dataclass, field

import openai
from dotenv import dotenv_values

from gtw import controller, extractor, prompts
from gtw.config import BACKEND_DIR, get_settings
from gtw.dialogue import up_to_first_question
from gtw.fields import FIELDS_BY_NAME
from gtw.llm import ProxyLLM
from gtw.state import CheckinState, Patient, Turn

MODELS = ["deepseek-ai/DeepSeek-V4-Flash-0731", "MiniMaxAI/MiniMax-M2.7", "zai-org/GLM-5.3-Flash"]
RUNS = 5
TIMEOUT_S = 20

TOOL = {
    "type": "function",
    "function": {
        "name": "record_answer",
        "description": "Record the patient's answer to a check-in question.",
        "parameters": {
            "type": "object",
            "properties": {"field": {"type": "string"}, "value": {"type": "string"}},
            "required": ["field", "value"],
        },
    },
}


@dataclass
class Result:
    target: str
    model: str
    ttft_ms: list[float] = field(default_factory=list)
    total_ms: list[float] = field(default_factory=list)
    json_ok: bool = False
    tools_ok: bool = False
    swedish_ok: bool = False
    extraction_ms: float | None = None
    sample: str = ""
    error: str = ""


def proxy_state() -> CheckinState:
    state = CheckinState.new(Patient(id="bench", name="Karin"))
    state.fields["respondent"].value, state.fields["respondent"].status = "proxy", "complete"
    state.transcript = [
        Turn(role="assistant", text="Verkar Karin annorlunda än vanligt idag?"),
        Turn(role="user", text="Hon verkar mer förvirrad idag och har knappt druckit något."),
    ]
    return state


async def measure_stream(llm: ProxyLLM, result: Result) -> None:
    started = time.perf_counter()
    first = None
    async for _ in llm.stream([{"role": "user", "content": "Säg god morgon på svenska i en kort mening."}]):
        first = first or time.perf_counter()
    end = time.perf_counter()
    result.ttft_ms.append(((first or end) - started) * 1000)
    result.total_ms.append((end - started) * 1000)


async def check_json(llm: ProxyLLM) -> bool:
    reply = await llm.complete(
        [{"role": "user", "content": 'Answer with the JSON object {"ok": true} and nothing else.'}]
    )
    return extractor.parse_json(reply) == {"ok": True}


async def check_tools(client: openai.AsyncOpenAI, model: str) -> bool:
    response = await client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": "The patient said they took their medication. Record it."}],
        tools=[TOOL],
        tool_choice="required",
    )
    calls = response.choices[0].message.tool_calls or []
    return any(json.loads(call.function.arguments).get("field") for call in calls)


async def check_swedish(llm: ProxyLLM, result: Result) -> None:
    """The production extraction and question calls, on the proxy's key sentence."""
    state = proxy_state()
    started = time.perf_counter()
    extracted = await extractor.extract(llm, state.transcript[-1].text, controller.open_fields(state), state)
    result.extraction_ms = (time.perf_counter() - started) * 1000
    values = {update.field: update.value for update in extracted.updates}
    result.swedish_ok = values.get("confusion") is True and values.get("intake") == "less"

    state.target = "trend"
    messages = prompts.dialogue_messages(state, FIELDS_BY_NAME["trend"])
    result.sample = " ".join("".join([chunk async for chunk in up_to_first_question(llm.stream(messages))]).split())


async def bench(target: str, base_url: str, api_key: str, model: str) -> Result:
    llm = ProxyLLM(base_url, api_key, model=model, timeout_s=TIMEOUT_S, json_mode=True)
    tools_client = openai.AsyncOpenAI(base_url=base_url, api_key=api_key, timeout=TIMEOUT_S, max_retries=0)
    result = Result(target, model)

    async def attempt(check):
        try:
            return await check
        except Exception as error:  # every failure is a data point here
            result.error = result.error or f"{type(error).__name__}: {error}"[:80]
            return None

    for _ in range(RUNS):
        await attempt(measure_stream(llm, result))
    result.json_ok = bool(await attempt(check_json(llm)))
    result.tools_ok = bool(await attempt(check_tools(tools_client, model)))
    await attempt(check_swedish(llm, result))
    return result


def brokers() -> dict[str, tuple[str, str]]:
    env = dotenv_values(BACKEND_DIR / ".env")
    found = {}
    for key, base in env.items():
        if key.startswith("BROKER_") and key.endswith("_API_BASE") and base:
            name = key.removeprefix("BROKER_").removesuffix("_API_BASE")
            found[name] = (base, env.get(f"BROKER_{name}_API_KEY") or "")
    return found


def print_table(results: list[Result]) -> None:
    def ms(values: list[float]) -> str:
        return f"{statistics.median(values):.0f}" if values else "-"

    def mark(ok: bool) -> str:
        return "yes" if ok else "no"

    header = f"{'target':<12} {'model':<36} {'ok':>4} {'ttft':>6} {'total':>6} "
    header += f"{'json':>5} {'tools':>5} {'sv':>4} {'extr':>6}"
    print(header)
    print("-" * len(header))
    for r in results:
        extraction_ms = f"{r.extraction_ms:.0f}" if r.extraction_ms else "-"
        print(
            f"{r.target:<12} {r.model:<36} {len(r.total_ms)}/{RUNS} {ms(r.ttft_ms):>6} {ms(r.total_ms):>6} "
            f"{mark(r.json_ok):>5} {mark(r.tools_ok):>5} {mark(r.swedish_ok):>4} {extraction_ms:>6}"
        )
    print("\nTimes are medians in ms. Dialogue samples and errors:")
    for r in results:
        print(f"- {r.target} / {r.model}: {r.sample or '-'}" + (f"  [{r.error}]" if r.error else ""))


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--proxy", action="store_true", help="benchmark the LiteLLM proxy instead of brokers")
    args = parser.parse_args()

    if args.proxy:
        settings = get_settings()
        jobs = [bench("proxy", settings.llm_base_url, settings.litellm_master_key, settings.dialogue_model)]
    else:
        targets = brokers()
        if not targets:
            raise SystemExit("No BROKER_<NAME>_API_BASE entries in .env")
        jobs = [bench(name, base, key, model) for name, (base, key) in targets.items() for model in MODELS]
    print_table(await asyncio.gather(*jobs))


if __name__ == "__main__":
    asyncio.run(main())
