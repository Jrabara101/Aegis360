"""
AegisCare 360 - Daily Activity Baseline Engine
Computes senior behavioral baselines and flags prolonged inactivity or missing routine transitions.
"""

from typing import Dict, Any, List, Optional
from datetime import datetime, timezone


class BaselineRuleEngine:
    """Evaluates senior activity logs against expected daily schedules."""

    DEFAULT_KITCHEN_CUTOFF = "10:00:00"

    def evaluate_inactivity(
        self,
        senior_id: str,
        events: List[Dict[str, Any]],
        baseline_schedule: Optional[Dict[str, Any]] = None,
        check_time: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        """
        Evaluates whether daily baselines have been breached.
        E.g. Checks if kitchen motion was detected prior to the scheduled cutoff time.
        """
        now = check_time or datetime.now(timezone.utc)
        schedule = baseline_schedule or {"kitchen_expected_by": "10:00"}
        kitchen_cutoff_str = schedule.get("kitchen_expected_by", "10:00")

        # Determine cutoff hour & minute
        parts = kitchen_cutoff_str.split(":")
        cutoff_hour = int(parts[0])
        cutoff_min = int(parts[1]) if len(parts) > 1 else 0

        # Check if current time has passed the cutoff
        cutoff_passed = (now.hour > cutoff_hour) or (now.hour == cutoff_hour and now.minute >= cutoff_min)

        # Inspect if kitchen motion was recorded today
        kitchen_motion_found = False
        last_motion_event = None

        for evt in events:
            loc = evt.get("location", "").lower()
            pir = evt.get("pir_motion_detected", False) or evt.get("event_type") == "NORMAL_MOTION"
            if pir:
                last_motion_event = evt
            if loc == "kitchen" and pir:
                kitchen_motion_found = True
                break

        breached = cutoff_passed and not kitchen_motion_found

        return {
            "senior_id": senior_id,
            "rule_id": "NO_KITCHEN_MOTION_BY_10AM",
            "is_breached": breached,
            "cutoff_time": f"{cutoff_hour:02d}:{cutoff_min:02d}",
            "current_time_evaluated": now.strftime("%H:%M:%S"),
            "kitchen_motion_detected": kitchen_motion_found,
            "last_detected_room": last_motion_event.get("location") if last_motion_event else "unknown",
            "last_detected_time": last_motion_event.get("timestamp") if last_motion_event else "unknown",
            "recommended_action": "INITIATE_ALEXA_VOICE_CHECKIN" if breached else "NONE",
        }
