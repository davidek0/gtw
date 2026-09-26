#!/usr/bin/env python3
"""Synchronize one Garmin Connect account with the local TypeScript backend."""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable


BACKEND_DIR = Path(__file__).resolve().parents[1]


def load_env_file() -> None:
    """Load simple KEY=VALUE entries from backend/.env without another dependency."""
    env_path = BACKEND_DIR / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if key:
            os.environ.setdefault(key, value)


def garmin_library() -> tuple[Any, tuple[type[Exception], ...]]:
    try:
        from garminconnect import (  # type: ignore[import-not-found]
            Garmin,
            GarminConnectAuthenticationError,
            GarminConnectConnectionError,
            GarminConnectTooManyRequestsError,
        )
    except ImportError as exc:
        raise SystemExit(
            "Garmin dependencies are not installed. Run this through an npm Garmin "
            "script, or install scripts/requirements-garmin.txt in Python 3.12+."
        ) from exc

    expected_errors = (
        GarminConnectAuthenticationError,
        GarminConnectConnectionError,
        GarminConnectTooManyRequestsError,
    )
    return Garmin, expected_errors


def token_store_path() -> Path:
    configured = os.getenv("GARMIN_TOKEN_STORE", ".garmin-tokens")
    path = Path(configured).expanduser()
    return path if path.is_absolute() else BACKEND_DIR / path


def login_with_saved_tokens() -> Any:
    Garmin, expected_errors = garmin_library()
    store = token_store_path()
    try:
        client = Garmin()
        client.login(str(store))
        return client
    except expected_errors as exc:
        raise SystemExit(
            "No valid Garmin login tokens were found. Run 'npm run garmin:login' first."
        ) from exc


def interactive_login() -> Any:
    Garmin, expected_errors = garmin_library()
    store = token_store_path()
    email = os.getenv("GARMIN_EMAIL", "").strip() or input("Garmin email: ").strip()
    if not email:
        raise SystemExit("A Garmin email address is required.")

    password = getpass.getpass("Garmin password (hidden): ")
    try:
        client = Garmin(
            email=email,
            password=password,
            prompt_mfa=lambda: input("Garmin MFA code: ").strip(),
        )
        password = ""
        client.login(str(store))
    except expected_errors as exc:
        raise SystemExit(f"Garmin login failed: {exc}") from exc

    print(f"Login successful. Refreshable tokens were saved in: {store}")
    print("The password was not saved. Do not commit or share the token directory.")
    return client


def collect_day(client: Any, day: str) -> list[dict[str, Any]]:
    calls: list[tuple[str, Callable[[], Any]]] = [
        ("daily_summary", lambda: client.get_user_summary(day)),
        ("steps", lambda: client.get_steps_data(day)),
        ("heart_rate", lambda: client.get_heart_rates(day)),
        ("sleep", lambda: client.get_sleep_data(day)),
        ("stress", lambda: client.get_stress_data(day)),
        ("body_battery", lambda: client.get_body_battery(day, day)),
        ("hrv", lambda: client.get_hrv_data(day)),
        ("spo2", lambda: client.get_spo2_data(day)),
        ("respiration", lambda: client.get_respiration_data(day)),
    ]
    records: list[dict[str, Any]] = []
    for metric_type, call in calls:
        try:
            data = call()
        except Exception as exc:  # Endpoints vary by account, watch, and firmware.
            print(f"Warning: {metric_type} unavailable for {day}: {exc}", file=sys.stderr)
            continue
        if data is not None:
            records.append({"type": metric_type, "data": data})
    return records


def ingest_url() -> str:
    base_url = os.getenv("BACKEND_URL", "http://127.0.0.1:3000").rstrip("/")
    return f"{base_url}/api/garmin-connect/ingest"


def send_records(subject_id: str, day: str, records: list[dict[str, Any]]) -> int:
    admin_token = os.getenv("ADMIN_API_TOKEN", "").strip()
    if not admin_token:
        raise SystemExit("ADMIN_API_TOKEN is missing from backend/.env.")

    payload = json.dumps(
        {"subjectId": subject_id, "date": day, "records": records},
        default=str,
        separators=(",", ":"),
    ).encode("utf-8")
    request = urllib.request.Request(
        ingest_url(),
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {admin_token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Backend ingest failed ({exc.code}): {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(
            f"Cannot reach {ingest_url()}. Start the TypeScript backend with 'npm run dev'."
        ) from exc
    return int(result.get("recordsUpserted", 0))


def dates_to_sync(days: int, exact_date: str | None) -> list[str]:
    if exact_date:
        try:
            return [date.fromisoformat(exact_date).isoformat()]
        except ValueError as exc:
            raise SystemExit("--date must use YYYY-MM-DD format.") from exc
    if days < 1 or days > 90:
        raise SystemExit("--days must be between 1 and 90.")
    today = date.today()
    return [(today - timedelta(days=offset)).isoformat() for offset in reversed(range(days))]


def sync_once(client: Any, days: int, exact_date: str | None, dry_run: bool) -> None:
    subject_id = os.getenv("GARMIN_SUBJECT_ID", "person-1").strip()
    if not subject_id:
        raise SystemExit("GARMIN_SUBJECT_ID is missing from backend/.env.")

    for day in dates_to_sync(days, exact_date):
        records = collect_day(client, day)
        if not records:
            print(f"{day}: Garmin returned no supported health data.")
            continue
        if dry_run:
            metric_names = ", ".join(record["type"] for record in records)
            print(f"{day}: fetched {len(records)} metrics ({metric_names}); not uploaded.")
            continue
        count = send_records(subject_id, day, records)
        print(f"{day}: upserted {count} health records for {subject_id}.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("login", help="Enter Garmin credentials/MFA and save reusable tokens.")

    default_days = int(os.getenv("GARMIN_SYNC_DAYS", "2"))
    sync = commands.add_parser("sync", help="Fetch Garmin data once and send it to the backend.")
    sync.add_argument("--days", type=int, default=default_days)
    sync.add_argument("--date", help="Fetch only one YYYY-MM-DD date.")
    sync.add_argument("--dry-run", action="store_true", help="Fetch without uploading.")

    poll = commands.add_parser("poll", help="Keep syncing at a fixed interval.")
    poll.add_argument("--days", type=int, default=default_days)
    poll.add_argument(
        "--interval",
        type=int,
        default=int(os.getenv("GARMIN_SYNC_INTERVAL_MINUTES", "15")),
        help="Minutes between syncs (minimum 5).",
    )
    return parser


def main() -> None:
    load_env_file()
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "login":
        interactive_login()
        return

    client = login_with_saved_tokens()
    if args.command == "sync":
        sync_once(client, args.days, args.date, args.dry_run)
        return

    if args.interval < 5:
        raise SystemExit("--interval must be at least 5 minutes to avoid excessive requests.")
    print(f"Polling Garmin every {args.interval} minutes. Press Ctrl+C to stop.")
    while True:
        try:
            sync_once(client, args.days, None, False)
        except Exception as exc:
            print(f"Sync failed: {exc}", file=sys.stderr)
        time.sleep(args.interval * 60)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")
