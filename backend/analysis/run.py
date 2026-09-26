#!/usr/bin/env python3
"""
Run the patient journal backend.

This script sets up the path correctly and starts the server.
"""

import sys
import os

# Add the current directory to the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Now we can import directly
from models import (
    Alert,
    AlertSeverity,
    HeartRateReading,
    InterviewData,
    WearableMetric,
    WearablePayload,
)
from storage import get_storage, PatientState
from processors import process_heart_rate_metric, process_interview
from api import app

import uvicorn

if __name__ == "__main__":
    print("Starting Patient Journal Backend...")
    print("API documentation available at http://localhost:8000/docs")
    print("\nEndpoints:")
    print("  POST /wearable    - Ingest wearable data")
    print("  POST /interview   - Ingest interview data")
    print("  GET  /alerts      - Get all alerts")
    print("  GET  /health      - Health check")
    print("  GET  /patient/{id}/status - Patient status")
    uvicorn.run(
        "run:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
