"""Speech-based nervousness + dominant mood (no CV / no camera)."""
from __future__ import annotations

from typing import Any, Dict


def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def _norm_above(value: float, low: float, high: float) -> float:
    """0 below low, 1 at/above high, linear in between."""
    if value <= low:
        return 0.0
    if value >= high:
        return 1.0
    return (value - low) / (high - low)


def _wpm_stress(wpm: float) -> float:
    """Ideal BA pace ~120–150 WPM. Too slow or too fast raises stress."""
    if 120 <= wpm <= 150:
        return 0.0
    if 100 <= wpm < 120:
        return _norm_above(120 - wpm, 0, 20)
    if 150 < wpm <= 170:
        return _norm_above(wpm - 150, 0, 20)
    if wpm < 100:
        return _clamp((100 - wpm) / 40)
    return _clamp((wpm - 170) / 40)


def estimate_affect(
    speech: Dict[str, Any] | None,
    linguistic: Dict[str, Any] | None,
    prosodic_confidence: float | Dict[str, Any] | None,
) -> Dict[str, Any]:
    """
    Map NLP / prosody signals → nervousness_pct + dominant_mood.
    Audio-only proxy — not facial CV.
    """
    speech = speech or {}
    linguistic = linguistic or {}

    if isinstance(prosodic_confidence, dict):
        prosody = float(prosodic_confidence.get("score", 50) or 50)
    else:
        prosody = float(prosodic_confidence or 50)

    pause_density = float(speech.get("pause_density", 0) or 0)
    pause_variance = float(speech.get("pause_variance", 0) or 0)
    filler_rate = float(speech.get("filler_rate", 0) or 0)
    wpm = float(speech.get("speech_rate_wpm", 0) or 0)
    repetition = float(linguistic.get("repetition_ratio", 0) or 0)
    aux = float(
        (linguistic.get("syntactic_uncertainty") or {}).get("aux_verb_ratio", 0) or 0
    )

    pause_stress = _clamp(
        0.6 * _norm_above(pause_density, 0.05, 0.20)
        + 0.4 * _norm_above(pause_variance, 0.2, 0.8)
    )
    filler_stress = _norm_above(filler_rate, 0.05, 0.15)
    wpm_stress = _wpm_stress(wpm)
    repetition_stress = _norm_above(repetition, 0.15, 0.35)
    uncertainty_stress = _norm_above(aux, 0.06, 0.15)
    prosody_stress = _clamp(1.0 - (prosody / 100.0))

    nervousness_01 = _clamp(
        0.25 * pause_stress
        + 0.20 * filler_stress
        + 0.15 * wpm_stress
        + 0.10 * repetition_stress
        + 0.10 * uncertainty_stress
        + 0.20 * prosody_stress
    )
    nervousness_pct = round(nervousness_01 * 100, 1)

    # Dominant mood from speech delivery (rules)
    if nervousness_pct >= 45 or (filler_stress > 0.6 and pause_stress > 0.5):
        dominant_mood = "Concerned"
    elif wpm > 155 and prosody >= 70 and pause_stress < 0.35:
        dominant_mood = "Excited"
    elif (
        nervousness_pct <= 25
        and 110 <= wpm <= 155
        and filler_stress < 0.4
        and prosody >= 65
    ):
        dominant_mood = "Confident"
    else:
        dominant_mood = "Neutral"

    return {
        "nervousness_pct": nervousness_pct,
        "dominant_mood": dominant_mood,
        "source": "nlp_prosody_proxy",
        "breakdown": {
            "pause_stress": round(pause_stress, 3),
            "filler_stress": round(filler_stress, 3),
            "wpm_stress": round(wpm_stress, 3),
            "repetition_stress": round(repetition_stress, 3),
            "uncertainty_stress": round(uncertainty_stress, 3),
            "prosody_stress": round(prosody_stress, 3),
        },
    }
