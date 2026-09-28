"""NLP + affect scoring config for Kashmir BA Linguistic."""
from dataclasses import dataclass


@dataclass
class NLPConfig:
    # Local Whisper: training video ASR only (see /transcribe).
    # medium >> small for Urdu + light EN mix; free local model (heavier CPU).
    whisper_model: str = "medium"
    # Urdu ASR for training + candidate answers (UI stays English).
    whisper_language: str = "ur"
    # Biases decoding toward brand/domain Urdu (reduces Latin gibberish).
    whisper_initial_prompt: str = (
        "ٹپال چائے، برانڈ ایمبیسیڈر، کوالٹی، صارفین، ذائقہ، چائے۔"
    )
    # Answer ASR: Groq only (no local Whisper fallback). Training stays local.
    answer_stt_provider: str = "groq"
    groq_stt_model: str = "whisper-large-v3-turbo"
    spacy_model: str = "en_core_web_sm"
    # Multilingual embeddings for Urdu↔Urdu question/training relevance.
    transformer_model: str = "paraphrase-multilingual-MiniLM-L12-v2"
    pause_threshold: float = 0.4

    wpm_min: int = 90
    wpm_max: int = 180
    wpm_strict_min: int = 100
    wpm_strict_max: int = 160
    penalty_wpm_high: int = 10
    penalty_wpm_med: int = 5

    rhythm_stability_high: float = 0.35
    rhythm_stability_med: float = 0.25
    penalty_rhythm_high: int = 10
    penalty_rhythm_med: int = 5

    pause_ratio_high: float = 0.30
    pause_ratio_med: float = 0.20
    penalty_pause_ratio_high: int = 12
    penalty_pause_ratio_med: int = 6

    avg_pause_high: float = 1.5
    avg_pause_med: float = 1.0
    penalty_avg_pause_high: int = 6
    penalty_avg_pause_med: int = 3

    filler_rate_high: float = 0.12
    filler_rate_med: float = 0.08
    penalty_filler_high: int = 7
    penalty_filler_med: int = 4

    lexical_richness_low: float = 0.30
    lexical_richness_med: float = 0.40
    penalty_lexical_high: int = 12
    penalty_lexical_med: int = 6

    repetition_ratio_high: float = 0.25
    repetition_ratio_med: float = 0.18
    penalty_repetition_high: int = 8
    penalty_repetition_med: int = 4

    sentence_length_std_high: float = 6
    sentence_length_std_med: float = 4
    penalty_sent_std_high: int = 6
    penalty_sent_std_med: int = 3

    aux_verb_ratio_high: float = 0.12
    penalty_aux_verb: int = 4

    semantic_instability_high: float = 0.40
    semantic_instability_med: float = 0.30
    penalty_semantic_high: int = 10
    penalty_semantic_med: int = 5

    prosodic_confidence_low: float = 60.0
    prosodic_confidence_med: float = 80.0
    penalty_prosodic_high: int = 15
    penalty_prosodic_med: int = 7

    relevance_low: float = 0.35
    relevance_med: float = 0.50
    penalty_relevance_high: int = 40
    penalty_relevance_med: int = 20
    relevance_cap_threshold: float = 0.30
    relevance_score_cap: float = 40.0
