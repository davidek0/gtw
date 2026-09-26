"""Command line shared by the text and voice check-ins."""

import argparse
import asyncio
import json
from collections.abc import Awaitable, Callable

from gtw.config import get_settings
from gtw.db import open_store
from gtw.dialogue import Dialogue, create_dialogue

LOG_FORMAT = "%(levelname)s %(name)s: %(message)s"


def parse_args(description: str, verbose_help: str) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=description, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--patient", required=True, help="patient name, e.g. Karin")
    parser.add_argument("--dry-run", action="store_true", help="use an in-memory store instead of Supabase")
    parser.add_argument("-v", "--verbose", action="store_true", help=verbose_help)
    return parser.parse_args()


def run_checkin(args: argparse.Namespace, session: Callable[[Dialogue], Awaitable[None]]) -> None:
    settings = get_settings()
    store, patient = open_store(settings, args.patient, dry_run=args.dry_run)
    dialogue = create_dialogue(patient, store, settings)
    asyncio.run(session(dialogue))

    print(f"\nCheck-in {dialogue.checkin_id} ended with status={dialogue.outcome}")
    if args.dry_run:
        print(json.dumps(store.get_checkin(dialogue.checkin_id), indent=2, ensure_ascii=False))
