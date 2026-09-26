"""Text-only check-in in the terminal. An empty line counts as silence.

uv run gtw-chat --patient Karin            # writes to Supabase
uv run gtw-chat --patient Karin --dry-run  # in-memory, prints the result
"""

import asyncio
import logging

from gtw.cli import LOG_FORMAT, parse_args, run_checkin
from gtw.dialogue import Dialogue


async def chat(dialogue: Dialogue) -> None:
    print(f"agent> {await dialogue.start()}")
    try:
        while not dialogue.ended:
            try:
                text = (await asyncio.to_thread(input, "you> ")).strip()
            except EOFError:
                break
            if not text:
                print(f"agent> {await dialogue.handle_silence()}")
                continue
            print("agent> ", end="", flush=True)
            async for speech in dialogue.handle(text):
                print(speech.text, end=" " if speech.kind == "acknowledgement" else "", flush=True)
            print()
    finally:
        await dialogue.close()


def main() -> None:
    args = parse_args(__doc__, "log extraction results and timings")
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING, format=LOG_FORMAT)
    run_checkin(args, chat)


if __name__ == "__main__":
    main()
