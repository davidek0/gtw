"""
FastAPI endpoints for the patient journal backend.

Endpoints:
- POST /wearable     - Ingest wearable metric data
- POST /interview    - Ingest AI interview data
- GET  /alerts       - Retrieve all alerts
- GET  /status       - Get backend status
"""

import logging
from datetime import datetime
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# Import models - handle both direct and package imports
try:
    from models import (
        Alert,
        InterviewData,
        WearableMetric,
        WearablePayload,
    )
    from processors import process_interview, process_wearable_metrics
    from storage import get_storage
except ImportError:
    from .models import (
        Alert,
        InterviewData,
        WearableMetric,
        WearablePayload,
    )
    from .processors import process_interview, process_wearable_metrics
    from .storage import get_storage

logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="Patient Journal Backend",
    description="Data processing and analysis for patient journal system. Generates alerts from wearable and interview data.",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# Configure CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Hackathon: allow all for demo
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# Health Check
# ============================================================================

@app.get("/health")
async def health_check() -> dict[str, Any]:
    """Health check endpoint."""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "patient_count": len(get_storage()._patients)
    }


# ============================================================================
# Wearable Data Endpoint
# ============================================================================

@app.post("/wearable", status_code=200)
async def ingest_wearable_data(payload: WearablePayload) -> dict[str, Any]:
    """
    Ingest wearable metric data.
    
    Expects a list of metrics. For hackathon MVP, processes heart_rate metrics.
    
    Example request body:
    ```json
    {
        "metrics": [
            {
                "id": "metric-id",
                "subject_id": "person-1",
                "record_date": "2026-09-25",
                "metric_type": "heart_rate",
                "data": {
                    "heartRateValues": [[1790326980000, 84], [1790327160000, 71]],
                    "restingHeartRate": 58
                }
            }
        ]
    }
    ```
    """
    logger.info(f"Received wearable data with {len(payload.metrics)} metrics")
    
    # Process all metrics
    alerts = process_wearable_metrics(payload.metrics)
    
    # Log alerts to console (hackathon requirement)
    for alert in alerts:
        logger.info(f"ALERT GENERATED: [{alert.severity.upper()}] {alert.message}")
        print(f"ALERT: [{alert.severity.upper()}] {alert.message}")
    
    return {
        "status": "processed",
        "metrics_received": len(payload.metrics),
        "alerts_generated": len(alerts),
        "alerts": [alert.model_dump() for alert in alerts]
    }


# ============================================================================
# Interview Data Endpoint
# ============================================================================

@app.post("/interview", status_code=200)
async def ingest_interview_data(interview: InterviewData) -> dict[str, Any]:
    """
    Ingest AI interview data.
    
    Processes structured fields and summary to generate alerts.
    
    Example request body:
    ```json
    {
        "id": "interview-id",
        "patient_id": "00000000-0000-4000-8000-000000000001",
        "started_at": "2026-09-26T09:59:52.109531+00:00",
        "ended_at": "2026-09-26T10:00:03.670602+00:00",
        "status": "completed",
        "respondent": "proxy",
        "summary": "Patient reports...",
        "fields": [
            {"field": "trend", "value": "worse"},
            {"field": "confusion", "value": true}
        ]
    }
    ```
    """
    logger.info(f"Received interview data: {interview.id}")
    
    # Process interview
    alerts = process_interview(interview)
    
    # Log alerts to console (hackathon requirement)
    for alert in alerts:
        logger.info(f"ALERT GENERATED: [{alert.severity.upper()}] {alert.message}")
        print(f"ALERT: [{alert.severity.upper()}] {alert.message}")
    
    return {
        "status": "processed",
        "interview_id": interview.id,
        "alerts_generated": len(alerts),
        "alerts": [alert.model_dump() for alert in alerts]
    }


# ============================================================================
# Alerts Endpoint
# ============================================================================

@app.get("/alerts")
async def get_alerts(patient_id: str | None = None) -> dict[str, Any]:
    """
    Retrieve alerts.
    
    Query params:
    - patient_id: Filter alerts by patient ID (optional)
    
    Returns all alerts, sorted by most recent first.
    """
    storage = get_storage()
    
    if patient_id:
        alerts = storage.get_alerts(patient_id)
    else:
        alerts = storage.get_all_alerts()
    
    return {
        "alerts": [alert.model_dump() for alert in alerts],
        "count": len(alerts)
    }


@app.get("/patient/{patient_id}/status")
async def get_patient_status(patient_id: str) -> dict[str, Any]:
    """
    Get current status for a patient.
    
    Returns heart rate history, interview history, and alerts.
    """
    storage = get_storage()
    patient = storage.get_patient(patient_id)
    
    return {
        "patient_id": patient_id,
        "heart_rate_history": [
            {"timestamp_ms": r.timestamp_ms, "value": r.value}
            for r in patient.heart_rate_history
        ],
        "heart_rate_average": patient.get_heart_rate_average(),
        "recent_interviews": len(patient.interview_history),
        "alerts": [alert.model_dump() for alert in patient.alerts],
        "last_data_time": patient.last_data_time.isoformat() if patient.last_data_time else None
    }


# ============================================================================
# Reset Endpoint (for testing)
# ============================================================================

@app.post("/reset")
async def reset_storage() -> dict[str, Any]:
    """
    Reset all storage (for testing only).
    
    WARNING: This clears all patient data and alerts.
    """
    storage = get_storage()
    storage.reset()
    return {"status": "reset", "message": "All storage cleared"}


# ============================================================================
# Run with: uvicorn analysis.api:app --reload
# ============================================================================
