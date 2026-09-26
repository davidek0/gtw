"""
In-memory storage for patient data.
Hackathon version: Single patient, simplified storage.
"""

from collections import deque
from datetime import datetime
from typing import Any, Optional

# Import models - handle both direct and package imports
try:
    from models import Alert, HeartRateReading, InterviewData
except ImportError:
    from .models import Alert, HeartRateReading, InterviewData


# ============================================================================
# Storage Classes
# ============================================================================

class PatientState:
    """State for a single patient."""
    
    def __init__(self, patient_id: str):
        self.patient_id = patient_id
        # Heart rate history: deque of last 50 non-null readings
        self.heart_rate_history: deque[HeartRateReading] = deque(maxlen=50)
        # Latest interview data
        self.latest_interview: Optional[InterviewData] = None
        # Interview history (last few)
        self.interview_history: deque[InterviewData] = deque(maxlen=10)
        # Generated alerts
        self.alerts: list[Alert] = []
        # Last alert times to prevent spam
        self.last_alert_time: Optional[datetime] = None
        # Track when we last saw data
        self.last_data_time: Optional[datetime] = None
    
    def add_heart_rate_reading(self, reading: HeartRateReading) -> None:
        """Add a heart rate reading to history."""
        self.heart_rate_history.append(reading)
        self.last_data_time = datetime.now()
    
    def get_heart_rate_average(self) -> Optional[float]:
        """Get rolling average of last 50 heart rate values."""
        if not self.heart_rate_history:
            return None
        values = [r.value for r in self.heart_rate_history]
        return sum(values) / len(values)
    
    def add_interview(self, interview: InterviewData) -> None:
        """Add interview data."""
        self.latest_interview = interview
        self.interview_history.append(interview)
        self.last_data_time = datetime.now()
    
    def add_alert(self, alert: Alert) -> None:
        """Add an alert."""
        self.alerts.append(alert)
        self.last_alert_time = alert.generated_at
    
    def clear_alerts(self) -> None:
        """Clear all alerts."""
        self.alerts = []


# ============================================================================
# Global Storage (Singleton for hackathon)
# ============================================================================

class PatientStorage:
    """
    Singleton storage for all patient data.
    Hackathon: Only one patient, but built to be extensible.
    """
    
    _instance: Optional["PatientStorage"] = None
    
    def __new__(cls) -> "PatientStorage":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self) -> None:
        if self._initialized:
            return
        self._patients: dict[str, PatientState] = {}
        self._initialized = True
    
    def get_patient(self, patient_id: str) -> PatientState:
        """Get or create patient state."""
        if patient_id not in self._patients:
            self._patients[patient_id] = PatientState(patient_id)
        return self._patients[patient_id]
    
    def get_all_patients(self) -> list[PatientState]:
        """Get all patient states."""
        return list(self._patients.values())
    
    def get_alerts(self, patient_id: str) -> list[Alert]:
        """Get alerts for a patient."""
        patient = self.get_patient(patient_id)
        return patient.alerts
    
    def get_all_alerts(self) -> list[Alert]:
        """Get all alerts across all patients."""
        all_alerts = []
        for patient in self._patients.values():
            all_alerts.extend(patient.alerts)
        # Sort by generated_at descending
        return sorted(all_alerts, key=lambda a: a.generated_at, reverse=True)
    
    def reset(self) -> None:
        """Reset all storage (for testing)."""
        self._patients = {}


# Global storage instance
storage = PatientStorage()


def get_storage() -> PatientStorage:
    """Get the global storage instance."""
    return storage
