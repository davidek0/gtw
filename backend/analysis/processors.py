"""
Data processors for generating alerts from wearable and interview data.

Hackathon MVP: Heart rate anomaly detection (30% spike from rolling average).
"""

import logging
from datetime import datetime
from typing import Optional

# Import models - handle both direct and package imports
try:
    from models import (
        Alert,
        AlertSeverity,
        HeartRateReading,
        InterviewData,
        WearableMetric,
    )
    from storage import get_storage, PatientState
except ImportError:
    from .models import (
        Alert,
        AlertSeverity,
        HeartRateReading,
        InterviewData,
        WearableMetric,
    )
    from .storage import get_storage, PatientState

logger = logging.getLogger(__name__)


# ============================================================================
# Configuration
# ============================================================================

# Heart rate anomaly threshold: 30% above rolling average
HEART_RATE_ANOMALY_THRESHOLD = 1.30

# Minimum number of readings before we can calculate a meaningful average
MIN_READINGS_FOR_AVERAGE = 5


# ============================================================================
# Heart Rate Processor
# ============================================================================

def process_heart_rate_metric(metric: WearableMetric) -> list[Alert]:
    """
    Process a heart rate metric and generate alerts if anomalies detected.
    
    Args:
        metric: WearableMetric with metric_type="heart_rate"
        
    Returns:
        List of Alert objects generated
    """
    alerts = []
    
    # Get patient state (single patient for hackathon)
    patient_id = metric.subject_id
    storage = get_storage()
    patient = storage.get_patient(patient_id)
    
    # Extract heart rate values from the metric
    if metric.metric_type != "heart_rate":
        logger.warning(f"Expected heart_rate metric, got {metric.metric_type}")
        return alerts
    
    heart_rate_data = metric.data
    if not hasattr(heart_rate_data, "heartRateValues"):
        logger.warning(f"Heart rate data missing heartRateValues")
        return alerts
    
    # Process each heart rate reading
    for hr_pair in heart_rate_data.heartRateValues:
        # hr_pair is [timestamp_ms, value] where value can be null
        if len(hr_pair) != 2:
            continue
        
        timestamp_ms = hr_pair[0]
        value = hr_pair[1]
        
        # Skip null values
        if value is None:
            continue
        
        # Create reading and store it
        reading = HeartRateReading(timestamp_ms=timestamp_ms, value=float(value))
        patient.add_heart_rate_reading(reading)
        
        # Check for anomaly (need at least MIN_READINGS_FOR_AVERAGE readings)
        avg = patient.get_heart_rate_average()
        if avg is not None and len(patient.heart_rate_history) >= MIN_READINGS_FOR_AVERAGE:
            if value > avg * HEART_RATE_ANOMALY_THRESHOLD:
                alert = Alert(
                    patient_id=patient_id,
                    generated_at=datetime.now(),
                    alert_type="heart_rate_anomaly",
                    severity=AlertSeverity.HIGH,
                    message=f"Heart rate anomaly: {value} BPM > {avg:.1f} BPM average (30% threshold)",
                    source_metric="heart_rate",
                    source_value=float(value),
                    context={
                        "current_value": value,
                        "rolling_average": avg,
                        "threshold": HEART_RATE_ANOMALY_THRESHOLD,
                        "history_count": len(patient.heart_rate_history)
                    }
                )
                alerts.append(alert)
                patient.add_alert(alert)
                logger.info(f"ALERT: {alert.message}")
    
    return alerts


def process_wearable_metrics(metrics: list[WearableMetric]) -> list[Alert]:
    """
    Process a list of wearable metrics.
    
    Args:
        metrics: List of WearableMetric objects
        
    Returns:
        List of all Alert objects generated
    """
    all_alerts = []
    
    for metric in metrics:
        if metric.metric_type == "heart_rate":
            alerts = process_heart_rate_metric(metric)
            all_alerts.extend(alerts)
        else:
            # For hackathon, we only process heart_rate
            # But architecture supports other metric types
            logger.debug(f"Skipping metric type: {metric.metric_type}")
    
    return all_alerts


# ============================================================================
# Interview Processor
# ============================================================================

def process_interview(interview: InterviewData) -> list[Alert]:
    """
    Process interview data and generate alerts based on structured fields.
    
    Hackathon MVP: Check for immediate conditions from interview.
    
    Args:
        interview: InterviewData object
        
    Returns:
        List of Alert objects generated
    """
    alerts = []
    patient_id = interview.patient_id
    storage = get_storage()
    patient = storage.get_patient(patient_id)
    
    # Store the interview
    patient.add_interview(interview)
    
    # Build field lookup for easy access
    fields_dict = {f.field: f.value for f in interview.fields}
    
    # Check for immediate conditions
    
    # 1. Patient fell
    mobility = fields_dict.get("mobility")
    if mobility and isinstance(mobility, dict) and mobility.get("fell") is True:
        alert = Alert(
            patient_id=patient_id,
            generated_at=datetime.now(),
            alert_type="patient_fell",
            severity=AlertSeverity.IMMEDIATE,
            message="Patient fell - immediate assistance required",
            source_metric="interview",
            context={
                "field": "mobility.fell",
                "value": True,
                "evidence": next(
                    (f.evidence for f in interview.fields if f.field == "mobility"),
                    ""
                )
            }
        )
        alerts.append(alert)
        patient.add_alert(alert)
        logger.info(f"ALERT: {alert.message}")
    
    # 2. Confusion detected
    if fields_dict.get("confusion") is True:
        alert = Alert(
            patient_id=patient_id,
            generated_at=datetime.now(),
            alert_type="confusion_detected",
            severity=AlertSeverity.HIGH,
            message="Patient is confused",
            source_metric="interview",
            context={
                "field": "confusion",
                "value": True
            }
        )
        alerts.append(alert)
        patient.add_alert(alert)
        logger.info(f"ALERT: {alert.message}")
    
    # 3. Trend is worse
    if fields_dict.get("trend") == "worse":
        alert = Alert(
            patient_id=patient_id,
            generated_at=datetime.now(),
            alert_type="condition_worsened",
            severity=AlertSeverity.MEDIUM,
            message="Patient condition has worsened",
            source_metric="interview",
            context={
                "field": "trend",
                "value": "worse"
            }
        )
        alerts.append(alert)
        patient.add_alert(alert)
        logger.info(f"ALERT: {alert.message}")
    
    # 4. Intake is less (eating/drinking less)
    if fields_dict.get("intake") == "less":
        alert = Alert(
            patient_id=patient_id,
            generated_at=datetime.now(),
            alert_type="reduced_intake",
            severity=AlertSeverity.MEDIUM,
            message="Patient has reduced food/fluid intake",
            source_metric="interview",
            context={
                "field": "intake",
                "value": "less"
            }
        )
        alerts.append(alert)
        patient.add_alert(alert)
        logger.info(f"ALERT: {alert.message}")
    
    # 5. More help needed with mobility
    if mobility and isinstance(mobility, dict) and mobility.get("more_help") is True:
        alert = Alert(
            patient_id=patient_id,
            generated_at=datetime.now(),
            alert_type="mobility_assistance_needed",
            severity=AlertSeverity.MEDIUM,
            message="Patient needs more help with mobility",
            source_metric="interview",
            context={
                "field": "mobility.more_help",
                "value": True
            }
        )
        alerts.append(alert)
        patient.add_alert(alert)
        logger.info(f"ALERT: {alert.message}")
    
    # 6. Check summary for keywords
    summary_lower = interview.summary.lower()
    keywords = ["fever", "fall", "chest pain", "shortness of breath", "dizzy"]
    for keyword in keywords:
        if keyword in summary_lower:
            alert = Alert(
                patient_id=patient_id,
                generated_at=datetime.now(),
                alert_type="keyword_detected",
                severity=AlertSeverity.MEDIUM,
                message=f"Keyword detected in summary: '{keyword}'",
                source_metric="interview",
                context={
                    "keyword": keyword,
                    "summary": interview.summary
                }
            )
            alerts.append(alert)
            patient.add_alert(alert)
            logger.info(f"ALERT: {alert.message}")
    
    return alerts


# ============================================================================
# Combined Processing
# ============================================================================

def process_all(patient_id: str) -> list[Alert]:
    """
    Process all stored data for a patient to generate current alerts.
    
    This can be called periodically or when new data arrives.
    
    Args:
        patient_id: Patient ID to process
        
    Returns:
        List of new Alert objects generated
    """
    storage = get_storage()
    patient = storage.get_patient(patient_id)
    
    alerts = []
    
    # Re-process heart rate data (in case we need to re-evaluate)
    # For hackathon, we process on ingest, but this allows re-evaluation
    if patient.heart_rate_history:
        avg = patient.get_heart_rate_average()
        if avg is not None:
            # Check the most recent reading
            latest = patient.heart_rate_history[-1]
            if latest.value > avg * HEART_RATE_ANOMALY_THRESHOLD:
                # Only alert if we haven't already alerted on this
                existing_hr_alerts = [
                    a for a in patient.alerts 
                    if a.alert_type == "heart_rate_anomaly" 
                    and a.source_value == latest.value
                ]
                if not existing_hr_alerts:
                    alert = Alert(
                        patient_id=patient_id,
                        generated_at=datetime.now(),
                        alert_type="heart_rate_anomaly",
                        severity=AlertSeverity.HIGH,
                        message=f"Heart rate anomaly: {latest.value:.0f} BPM > {avg:.1f} BPM average",
                        source_metric="heart_rate",
                        source_value=latest.value,
                        context={"rolling_average": avg}
                    )
                    alerts.append(alert)
                    patient.add_alert(alert)
    
    return alerts
