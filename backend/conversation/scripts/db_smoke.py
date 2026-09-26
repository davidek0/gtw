"""Write a fake check-in with fields and an alert through the db helpers, then read it back.

uv run python scripts/db_smoke.py [--patient Karin]
"""

import argparse
import json
from uuid import uuid4

from gtw.config import get_settings
from gtw.db import open_store
from gtw.state import FieldState, Turn, utcnow


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--patient", default="Karin")
    args = parser.parse_args()

    store, patient = open_store(get_settings(), args.patient, dry_run=False)

    checkin_id = str(uuid4())
    transcript = [Turn(role="assistant", text="Test"), Turn(role="user", text="Test")]
    fields = [
        FieldState(field="respondent", value="proxy", status="complete", evidence="dottern", attempts=1),
        FieldState(field="intake", value="less", status="complete", evidence="knappt druckit", attempts=1),
    ]
    store.start_checkin(checkin_id, patient.id, utcnow())
    store.set_device_state(patient.id, "alert")
    store.insert_alert(patient.id, checkin_id, "red_flag", "Smoke test, ignore")
    store.finish_checkin(
        checkin_id,
        status="red_flag",
        respondent="proxy",
        summary=None,
        ended_at=utcnow(),
        transcript=transcript,
        fields=fields,
    )
    store.set_device_state(patient.id, "idle")
    print(json.dumps(store.get_checkin(checkin_id), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
