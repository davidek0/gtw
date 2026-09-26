"""Persistence for check-ins. Uses the service role key: backend only."""

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any, Literal
from uuid import uuid4

from gtw.config import Settings
from gtw.state import CheckinStatus, FieldState, Patient, Turn, utcnow
from supabase import Client, create_client

DeviceState = Literal["idle", "ringing", "listening", "thinking", "speaking", "alert"]
AlertKind = Literal["red_flag", "missed_checkin"]


def _transcript_json(transcript: list[Turn]) -> list[dict[str, Any]]:
    return [turn.model_dump(mode="json") for turn in transcript]


def _field_rows(checkin_id: str, fields: list[FieldState]) -> list[dict[str, Any]]:
    return [{"checkin_id": checkin_id, **field.model_dump(mode="json")} for field in fields]


class CheckinStore(ABC):
    """Builds the check-in rows; subclasses only provide the table access."""

    @abstractmethod
    def get_patient(self, name: str) -> Patient | None: ...

    @abstractmethod
    def get_checkin(self, checkin_id: str) -> dict[str, Any]: ...

    @abstractmethod
    def set_device_state(self, patient_id: str, state: DeviceState) -> None: ...

    @abstractmethod
    def _insert_checkin(self, row: dict[str, Any]) -> None: ...

    @abstractmethod
    def _update_checkin(self, checkin_id: str, values: dict[str, Any]) -> None: ...

    @abstractmethod
    def _upsert_fields(self, rows: list[dict[str, Any]]) -> None: ...

    @abstractmethod
    def _insert_alert(self, row: dict[str, Any]) -> None: ...

    def start_checkin(self, checkin_id: str, patient_id: str, started_at: datetime) -> None:
        self._insert_checkin(
            {"id": checkin_id, "patient_id": patient_id, "started_at": started_at.isoformat(), "transcript": []}
        )

    def save_progress(self, checkin_id: str, transcript: list[Turn], fields: list[FieldState]) -> None:
        self._update_checkin(checkin_id, {"transcript": _transcript_json(transcript)})
        self._upsert_fields(_field_rows(checkin_id, fields))

    def mark_red_flag(self, checkin_id: str) -> None:
        self._update_checkin(checkin_id, {"status": "red_flag"})

    def insert_alert(self, patient_id: str, checkin_id: str | None, kind: AlertKind, message: str) -> None:
        self._insert_alert({"patient_id": patient_id, "checkin_id": checkin_id, "kind": kind, "message": message})

    def finish_checkin(
        self,
        checkin_id: str,
        *,
        status: CheckinStatus,
        respondent: str,
        summary: str | None,
        ended_at: datetime,
        transcript: list[Turn],
        fields: list[FieldState],
    ) -> None:
        # Fields first: downstream treats a check-in with ended_at set as final.
        self._upsert_fields(_field_rows(checkin_id, fields))
        self._update_checkin(
            checkin_id,
            {
                "transcript": _transcript_json(transcript),
                "respondent": respondent,
                "summary": summary,
                "status": status,
                "ended_at": ended_at.isoformat(),
            },
        )


class SupabaseStore(CheckinStore):
    def __init__(self, client: Client):
        self.client = client

    @classmethod
    def from_settings(cls, settings: Settings) -> "SupabaseStore":
        if not settings.supabase_url or not settings.supabase_service_key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env")
        return cls(create_client(settings.supabase_url, settings.supabase_service_key))

    def get_patient(self, name: str) -> Patient | None:
        rows = self.client.table("patients").select("*").ilike("name", name).limit(1).execute().data
        return Patient(**{**rows[0], "modules": rows[0].get("modules") or []}) if rows else None

    def get_checkin(self, checkin_id: str) -> dict[str, Any]:
        checkin = self.client.table("checkins").select("*").eq("id", checkin_id).single().execute().data
        checkin["fields"] = self.client.table("checkin_fields").select("*").eq("checkin_id", checkin_id).execute().data
        checkin["alerts"] = self.client.table("alerts").select("*").eq("checkin_id", checkin_id).execute().data
        return checkin

    def set_device_state(self, patient_id: str, state: DeviceState) -> None:
        self.client.table("device_state").upsert(
            {"patient_id": patient_id, "state": state, "updated_at": utcnow().isoformat()}
        ).execute()

    def _insert_checkin(self, row: dict[str, Any]) -> None:
        self.client.table("checkins").insert(row).execute()

    def _update_checkin(self, checkin_id: str, values: dict[str, Any]) -> None:
        self.client.table("checkins").update(values).eq("id", checkin_id).execute()

    def _upsert_fields(self, rows: list[dict[str, Any]]) -> None:
        if rows:
            self.client.table("checkin_fields").upsert(rows, on_conflict="checkin_id,field").execute()

    def _insert_alert(self, row: dict[str, Any]) -> None:
        self.client.table("alerts").insert(row).execute()


class MemoryStore(CheckinStore):
    """In-memory store with the same shape as the database, for tests and dry runs."""

    def __init__(self, patients: list[Patient] | None = None):
        self.patients = {patient.id: patient for patient in patients or []}
        self.checkins: dict[str, dict[str, Any]] = {}
        self.fields: dict[tuple[str, str], dict[str, Any]] = {}
        self.alerts: list[dict[str, Any]] = []
        self.device_states: dict[str, list[DeviceState]] = {}

    def get_patient(self, name: str) -> Patient | None:
        return next((p for p in self.patients.values() if p.name.lower() == name.lower()), None)

    def get_checkin(self, checkin_id: str) -> dict[str, Any]:
        return {
            **self.checkins[checkin_id],
            "fields": [row for (cid, _), row in self.fields.items() if cid == checkin_id],
            "alerts": [alert for alert in self.alerts if alert["checkin_id"] == checkin_id],
        }

    def set_device_state(self, patient_id: str, state: DeviceState) -> None:
        self.device_states.setdefault(patient_id, []).append(state)

    def _insert_checkin(self, row: dict[str, Any]) -> None:
        self.checkins[row["id"]] = dict.fromkeys(("ended_at", "status", "respondent", "summary")) | row

    def _update_checkin(self, checkin_id: str, values: dict[str, Any]) -> None:
        self.checkins[checkin_id].update(values)

    def _upsert_fields(self, rows: list[dict[str, Any]]) -> None:
        for row in rows:
            self.fields[(row["checkin_id"], row["field"])] = row

    def _insert_alert(self, row: dict[str, Any]) -> None:
        self.alerts.append({"id": str(uuid4()), **row})


def open_store(settings: Settings, patient_name: str, *, dry_run: bool) -> tuple[CheckinStore, Patient]:
    """An in-memory store with a throwaway patient for dry runs, otherwise Supabase."""
    if dry_run:
        patient = Patient(id="dry-run", name=patient_name)
        return MemoryStore([patient]), patient
    store = SupabaseStore.from_settings(settings)
    if (patient := store.get_patient(patient_name)) is None:
        raise SystemExit(f"No patient named {patient_name!r}. Run scripts/dev_seed.py first.")
    return store, patient
