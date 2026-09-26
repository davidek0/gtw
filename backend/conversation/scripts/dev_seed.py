"""Create a few fictional test patients for development. Safe to re-run.

uv run python scripts/dev_seed.py
"""

from gtw.config import get_settings
from gtw.db import SupabaseStore

PATIENTS = [
    {
        "id": "00000000-0000-4000-8000-000000000001",
        "name": "Karin",
        "age": 84,
        "proxy_name": "dottern Anna",
        "modules": [],
        "checkin_time": "09:00",
    },
    {
        "id": "00000000-0000-4000-8000-000000000002",
        "name": "Gösta",
        "age": 79,
        "proxy_name": "hemtjänsten",
        "modules": [],
        "checkin_time": "10:00",
    },
    {
        "id": "00000000-0000-4000-8000-000000000003",
        "name": "Birgit",
        "age": 88,
        "proxy_name": "sonen Erik",
        "modules": ["heart_failure"],
        "checkin_time": "09:30",
    },
]


def main() -> None:
    client = SupabaseStore.from_settings(get_settings()).client
    client.table("patients").upsert(PATIENTS).execute()
    client.table("device_state").upsert([{"patient_id": p["id"], "state": "idle"} for p in PATIENTS]).execute()
    print("Seeded:", ", ".join(p["name"] for p in PATIENTS))


if __name__ == "__main__":
    main()
