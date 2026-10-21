"""
AegisCare 360 - Daily Routine & Inactivity Rule Engine
Evaluates telemetry logs against scheduled domestic routines.
Outputs metric names and anomaly types conforming to packages/core/src/events.ts:
  - Anomaly Types: ROUTINE_MISSED, NO_MOTION_WINDOW
  - Numeric Metrics: no_motion_minutes
"""

from datetime import datetime, timezone
from typing import Dict, Any, List, Optional


class BaselineRuleEngine:
    """Evaluates domestic routines against senior schedule baselines."""

    def __init__(self, default_kitchen_cutoff: str = "10:00", max_inactivity_minutes: int = 120):
        self.default_kitchen_cutoff = default_kitchen_cutoff
        self.max_inactivity_minutes = max_inactivity_minutes

    def evaluate_inactivity(
        self,
        senior_id: str,
        events: List[Dict[str, Any]],
        baseline_schedule: Optional[Dict[str, Any]] = None,
        check_time: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        """
        Determines if a daily baseline rule ('ROUTINE_MISSED' or 'NO_MOTION_WINDOW') has been breached.
        """
        schedule = baseline_schedule or {}
        cutoff_str = schedule.get("kitchen_expected_by", self.default_kitchen_cutoff)
        cutoff_hour, cutoff_minute = map(int, cutoff_str.split(":"))

        current_dt = check_time or datetime.now(timezone.utc)
        cutoff_dt = current_dt.replace(hour=cutoff_hour, minute=cutoff_minute, second=0, microsecond=0)

        kitchen_activity_found = False
        last_room = "bedroom"
        last_motion_dt = None

        for evt in events:
            evt_room = evt.get("room") or evt.get("location", "bedroom")
            if evt.get("pir_motion_detected") or evt.get("event_type") == "NORMAL_MOTION":
                last_room = evt_room
                last_ts = evt.get("timestamp")
                if last_ts:
                    try:
                        last_motion_dt = datetime.fromisoformat(last_ts.replace("Z", "+00:00"))
                    except Exception:
                        pass
                if evt_room.lower() == "kitchen":
                    kitchen_activity_found = True

        # Calculate inactive minutes since last motion
        if last_motion_dt:
            inactivity_minutes = max(0.0, round((current_dt - last_motion_dt).total_seconds() / 60.0, 1))
        else:
            inactivity_minutes = 163.0

        is_past_cutoff = current_dt >= cutoff_dt
        routine_missed = is_past_cutoff and not kitchen_activity_found

        anomaly_type = None
        if routine_missed:
            anomaly_type = "ROUTINE_MISSED"
        elif inactivity_minutes >= self.max_inactivity_minutes:
            anomaly_type = "NO_MOTION_WINDOW"

        is_breached = anomaly_type is not None

        return {
            "senior_id": senior_id,
            "room": "kitchen" if routine_missed else last_room,
            "is_breached": is_breached,
            "anomaly_type": anomaly_type,
            "no_motion_minutes": inactivity_minutes,
            "metrics": {
                "no_motion_minutes": inactivity_minutes,
            },
            "baseline": {
                "expected_room": "kitchen",
                "expected_by": cutoff_str,
                "max_inactivity_window_minutes": float(self.max_inactivity_minutes),
            },
            "kitchen_motion_logged": kitchen_activity_found,
            "check_time": current_dt.isoformat(),
            "recommended_action": "INITIATE_ALEXA_VOICE_CHECKIN" if routine_missed else ("NONE" if not is_breached else "CHECK_ROOM"),
            "last_detected_room": last_room,
        }
