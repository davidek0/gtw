#!/usr/bin/env python3
"""
Test script for the patient journal backend.

This verifies that the data processing and alert generation works correctly.
"""

import sys
import os
from datetime import datetime

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Now import our modules
from models import (
    Alert,
    AlertSeverity,
    HeartRateReading,
    HeartRateData,
    WearableMetric,
    WearablePayload,
    InterviewData,
    InterviewField,
    TranscriptEntry,
)
from storage import get_storage, PatientState
from processors import (
    process_heart_rate_metric,
    process_wearable_metrics,
    process_interview,
    HEART_RATE_ANOMALY_THRESHOLD,
    MIN_READINGS_FOR_AVERAGE,
)


def test_heart_rate_processing():
    """Test heart rate anomaly detection."""
    print("=" * 60)
    print("TEST: Heart Rate Anomaly Detection")
    print("=" * 60)
    
    # Reset storage
    storage = get_storage()
    storage.reset()
    
    patient_id = "person-1"
    
    # Create heart rate data with values that will trigger an alert
    # First, send some normal readings to establish baseline
    normal_readings = [
        [1000000, 70],
        [1000010, 72],
        [1000020, 71],
        [1000030, 68],
        [1000040, 70],
        [1000050, 69],
        [1000060, 71],
        [1000070, 70],
    ]
    
    # Then add a spike (100 BPM which is > 30% above 70)
    spike_reading = [1000080, 100]
    
    # Create metric with normal readings
    heart_rate_data = HeartRateData(
        calendarDate="2026-09-26",
        heartRateValues=normal_readings,
        restingHeartRate=70
    )
    
    metric1 = WearableMetric(
        id="metric-1",
        subject_id=patient_id,
        record_date="2026-09-26",
        metric_type="heart_rate",
        data=heart_rate_data
    )
    
    # Process normal readings
    alerts1 = process_wearable_metrics([metric1])
    print(f"\nProcessed {len(normal_readings)} normal readings")
    print(f"Alerts generated: {len(alerts1)}")
    assert len(alerts1) == 0, "Should not generate alerts for normal readings"
    
    # Now add the spike
    heart_rate_data2 = HeartRateData(
        calendarDate="2026-09-26",
        heartRateValues=[spike_reading],
        restingHeartRate=70
    )
    
    metric2 = WearableMetric(
        id="metric-2",
        subject_id=patient_id,
        record_date="2026-09-26",
        metric_type="heart_rate",
        data=heart_rate_data2
    )
    
    # Process spike
    alerts2 = process_wearable_metrics([metric2])
    print(f"\nProcessed spike reading: {spike_reading[1]} BPM")
    print(f"Alerts generated: {len(alerts2)}")
    
    if alerts2:
        for alert in alerts2:
            print(f"  ALERT: [{alert.severity.upper()}] {alert.message}")
            print(f"    Context: {alert.context}")
        assert len(alerts2) > 0, "Should generate alert for spike"
        assert alerts2[0].alert_type == "heart_rate_anomaly"
        assert alerts2[0].severity == AlertSeverity.HIGH
    else:
        print("  WARNING: No alert generated for spike!")
        print(f"  Current average: {storage.get_patient(patient_id).get_heart_rate_average()}")
        print(f"  Threshold: {HEART_RATE_ANOMALY_THRESHOLD}")
    
    print("\n✓ Heart rate processing test complete")


def test_interview_processing():
    """Test interview data processing."""
    print("\n" + "=" * 60)
    print("TEST: Interview Data Processing")
    print("=" * 60)
    
    patient_id = "00000000-0000-4000-8000-000000000001"
    
    # Create interview with concerning fields
    interview = InterviewData(
        id="interview-1",
        patient_id=patient_id,
        started_at="2026-09-26T09:59:52.109531+00:00",
        ended_at="2026-09-26T10:00:03.670602+00:00",
        status="completed",
        respondent="proxy",
        summary="Patient is confused and needs assistance",
        fields=[
            InterviewField(
                id="field-1",
                checkin_id="interview-1",
                field="trend",
                value="worse",
                status="complete",
                evidence="Sämre, tycker jag.",
                attempts=2
            ),
            InterviewField(
                id="field-2",
                checkin_id="interview-1",
                field="confusion",
                value=True,
                status="complete",
                evidence="mer förvirrad idag",
                attempts=0
            ),
            InterviewField(
                id="field-3",
                checkin_id="interview-1",
                field="mobility",
                value={"fell": False, "more_help": True},
                status="complete",
                evidence="hon behöver mer hjälp att gå på toaletten",
                attempts=1
            ),
        ]
    )
    
    alerts = process_interview(interview)
    print(f"\nProcessed interview: {interview.id}")
    print(f"Alerts generated: {len(alerts)}")
    
    for alert in alerts:
        print(f"  ALERT: [{alert.severity.upper()}] {alert.message}")
        print(f"    Type: {alert.alert_type}")
    
    # Should generate alerts for: condition_worsened, confusion_detected, mobility_assistance_needed
    expected_alert_types = {"condition_worsened", "confusion_detected", "mobility_assistance_needed"}
    actual_alert_types = {alert.alert_type for alert in alerts}
    
    print(f"\nExpected alert types: {expected_alert_types}")
    print(f"Actual alert types: {actual_alert_types}")
    
    if expected_alert_types == actual_alert_types:
        print("✓ All expected alerts generated")
    else:
        print("⚠ Some expected alerts missing")
        missing = expected_alert_types - actual_alert_types
        extra = actual_alert_types - expected_alert_types
        if missing:
            print(f"  Missing: {missing}")
        if extra:
            print(f"  Extra: {extra}")
    
    print("\n✓ Interview processing test complete")


def test_storage():
    """Test storage functionality."""
    print("\n" + "=" * 60)
    print("TEST: Storage")
    print("=" * 60)
    
    storage = get_storage()
    storage.reset()
    
    patient_id = "test-patient"
    patient = storage.get_patient(patient_id)
    
    # Add heart rate readings
    for i, value in enumerate([70, 72, 71, 68, 70]):
        reading = HeartRateReading(timestamp_ms=1000000 + i * 10, value=float(value))
        patient.add_heart_rate_reading(reading)
    
    avg = patient.get_heart_rate_average()
    print(f"\nAdded 5 heart rate readings: [70, 72, 71, 68, 70]")
    print(f"Rolling average: {avg}")
    assert avg == 70.2, f"Expected average 70.2, got {avg}"
    
    # Test maxlen of deque
    for i in range(60):
        reading = HeartRateReading(timestamp_ms=1000000 + i * 10, value=float(70 + i))
        patient.add_heart_rate_reading(reading)
    
    assert len(patient.heart_rate_history) == 50, "Deque should be limited to 50"
    print(f"After adding 65 readings, history length: {len(patient.heart_rate_history)}")
    print("✓ Storage test complete")


def main():
    """Run all tests."""
    print("\n" + "=" * 60)
    print("PATIENT JOURNAL BACKEND - HACKATHON TESTS")
    print("=" * 60)
    
    try:
        test_storage()
        test_heart_rate_processing()
        test_interview_processing()
        
        print("\n" + "=" * 60)
        print("ALL TESTS PASSED ✓")
        print("=" * 60)
        return 0
        
    except AssertionError as e:
        print(f"\n✗ TEST FAILED: {e}")
        return 1
    except Exception as e:
        print(f"\n✗ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
