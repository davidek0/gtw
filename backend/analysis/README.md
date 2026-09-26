# Patient Journal Backend - Data Processing & Analysis

Data processing and analysis module for the patient journal system. Processes wearable data and AI interview data to generate actionable alerts for doctors.

## Hackathon MVP

This is a minimal implementation for the hackathon focused on:
- **Heart rate anomaly detection**: 30% spike from rolling average of last 50 values
- **Interview data processing**: Detects conditions from structured fields (confusion, falls, worsening trend, reduced intake, mobility issues)
- **Alert generation**: Console logging of alerts with severity levels
- **Single patient**: Simplified for hackathon (one patient, no ID mapping needed)

## Quick Start

```bash
# Install dependencies
python3 -m pip install --break-system-packages -r pyproject.toml

# Run the backend server
python3 run.py

# Or run tests
python3 test_backend.py
```

The server will start on `http://localhost:8000`. API documentation is available at `http://localhost:8000/docs`.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/wearable` | Ingest wearable metric data |
| POST | `/interview` | Ingest AI interview data |
| GET | `/alerts` | Retrieve all alerts |
| GET | `/alerts?patient_id={id}` | Filter alerts by patient |
| GET | `/patient/{id}/status` | Get patient status |
| GET | `/health` | Health check |
| POST | `/reset` | Reset storage (testing only) |

## Data Formats

### Wearable Data (Heart Rate)

```json
{
  "metrics": [
    {
      "id": "metric-id",
      "subject_id": "person-1",
      "record_date": "2026-09-25",
      "metric_type": "heart_rate",
      "data": {
        "calendarDate": "2026-09-25",
        "heartRateValues": [[1790326980000, 84], [1790327160000, 71]],
        "restingHeartRate": 58,
        "lastSevenDaysAvgRestingHeartRate": 58
      }
    }
  ]
}
```

- `heartRateValues`: Array of `[timestamp_ms, value]` pairs
- Null values are filtered out
- Only `heart_rate` metric type is processed in MVP

### Interview Data

```json
{
  "id": "interview-id",
  "patient_id": "00000000-0000-4000-8000-000000000001",
  "started_at": "2026-09-26T09:59:52.109531+00:00",
  "ended_at": "2026-09-26T10:00:03.670602+00:00",
  "status": "completed",
  "respondent": "proxy",
  "summary": "Patient reports feeling worse and is confused",
  "fields": [
    {"field": "trend", "value": "worse"},
    {"field": "confusion", "value": true},
    {"field": "mobility", "value": {"fell": false, "more_help": true}}
  ]
}
```

## Alert Types

### Heart Rate Alerts
- **`heart_rate_anomaly`** (HIGH): Heart rate > 130% of rolling average

### Interview Alerts
- **`patient_fell`** (IMMEDIATE): Patient reported a fall
- **`confusion_detected`** (HIGH): Patient is confused
- **`condition_worsened`** (MEDIUM): Patient condition trending worse
- **`reduced_intake`** (MEDIUM): Reduced food/fluid intake
- **`mobility_assistance_needed`** (MEDIUM): Needs more mobility help
- **`keyword_detected`** (MEDIUM): Keywords in summary (fever, fall, chest pain, etc.)

All alerts are logged to console with severity level.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      API Layer (api.py)                         │
│  POST /wearable    POST /interview    GET /alerts              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Processing Layer (processors.py)              │
│  process_wearable_metrics()    process_interview()              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Storage Layer (storage.py)                  │
│  PatientState: heart_rate_history, interviews, alerts           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    Console Output (Alerts)
```

## File Structure

```
backend/analysis/
├── __init__.py           # Package init
├── models.py             # Pydantic data models
├── storage.py            # In-memory patient data storage
├── processors.py         # Data processing and alert generation
├── api.py                # FastAPI endpoints
├── main.py               # Server entry point (uvicorn)
├── run.py                # Alternative server entry point
├── test_backend.py       # Test script
├── pyproject.toml        # Dependencies and config
└── README.md             # This file
```

## Configuration

Key parameters (edit in `processors.py`):

```python
HEART_RATE_ANOMALY_THRESHOLD = 1.30  # 30% above average
MIN_READINGS_FOR_AVERAGE = 5         # Min readings before alerting
```

## Docker Integration

The backend is designed to be containerized. Other Docker containers (wearable data, AI interview) POST to these endpoints.

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY backend/analysis /app
RUN pip install --break-system-packages -r pyproject.toml
CMD ["python", "run.py"]
```

## Running Tests

```bash
# Run all tests
python3 test_backend.py

# Run specific test
gython3 -c "from test_backend import test_heart_rate_processing; test_heart_rate_processing()"
```

## Future Enhancements

- [ ] Add persistence (SQLite, PostgreSQL)
- [ ] Multi-patient support with proper ID mapping
- [ ] Blood pressure anomaly detection
- [ ] Step count zero-detection
- [ ] Fever risk from interview + wearable correlation
- [ ] Disease X integration (patient medical history)
- [ ] Alert deduplication and throttling
- [ ] Webhook/email alert delivery
- [ ] Authentication and authorization
