import whisper
import librosa
import numpy as np
import nltk
import re
import spacy
from collections import Counter
from pathlib import Path
from ba_engine.logger import logger
from ba_engine.config import NLPConfig
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
from nltk.tokenize import sent_tokenize, word_tokenize
from ba_engine.groq_stt import transcribe_with_groq
import os


# Lexical fillers (EN + common Urdu hesitation particles) for combined metric.
_FILLER_TOKENS = {
    "um",
    "uh",
    "umm",
    "uhh",
    "erm",
    "ah",
    "ahh",
    "eh",
    "hmm",
    "hm",
    "uhhuh",
    "آہ",
    "اہ",
    "ام",
    "اَم",
    "ہمم",
    "ہم",
}
# NLTK Downloads (Safe check)
try:
    nltk.data.find('tokenizers/punkt')
    nltk.data.find('tokenizers/punkt_tab')
except LookupError:
    nltk.download('punkt')
    nltk.download('punkt_tab')


def _json_float(value, ndigits=None):
    """Coerce numeric values (including numpy scalars) to native Python float."""
    if isinstance(value, (np.floating, np.integer)):
        value = value.item()
    number = float(value)
    if ndigits is not None:
        return round(number, ndigits)
    return number


# Arabic / Urdu script block (includes digits/punctuation used with Nastaliq).
_URDU_CHAR_RE = re.compile(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]")
_URDU_SENT_SPLIT_RE = re.compile(r"(?<=[۔.!؟?\n])\s+")
_URDU_WORD_RE = re.compile(
    r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF0-9A-Za-z]+"
)


def _looks_like_urdu(text: str) -> bool:
    if not text:
        return False
    urdu = len(_URDU_CHAR_RE.findall(text))
    latin = len(re.findall(r"[A-Za-z]", text))
    return urdu > 0 and urdu >= latin


def _tokenize_sentences(text: str):
    text = (text or "").strip()
    if not text:
        return []
    if _looks_like_urdu(text):
        parts = [p.strip() for p in _URDU_SENT_SPLIT_RE.split(text) if p.strip()]
        return parts or [text]
    return sent_tokenize(text)


def _tokenize_words(text: str):
    text = (text or "").strip()
    if not text:
        return []
    if _looks_like_urdu(text):
        return [w for w in _URDU_WORD_RE.findall(text) if w]
    return word_tokenize(text.lower())


class NLPAnalyzerComponent:
    # --- SHARED MODELS (Optimized for speed) ---
    _models_loaded = False
    _whisper_model = None
    _nlp_spacy = None
    _embedder = None

    def __init__(self, config: NLPConfig):
        """
        Initializes NLP models and configuration.
        Audio path is now passed in run() method.
        """
        self.config = config
        
        # Load models ONLY if they haven't been loaded yet (Singleton Pattern)
        if not NLPAnalyzerComponent._models_loaded:
            logger.info(
              "⏳ Loading NLP Models (Whisper ur, Spacy, multilingual MiniLM)... This happens only once."
            )
            
            # 1. Load Whisper
            NLPAnalyzerComponent._whisper_model = whisper.load_model(self.config.whisper_model)
            
            # 2. Load Spacy
            try:
                NLPAnalyzerComponent._nlp_spacy = spacy.load(self.config.spacy_model)
            except OSError:
                logger.warning(f"Spacy model '{self.config.spacy_model}' not found. Downloading...")
                from spacy.cli import download
                download(self.config.spacy_model)
                NLPAnalyzerComponent._nlp_spacy = spacy.load(self.config.spacy_model)

            # 3. Load Sentence Transformer
            NLPAnalyzerComponent._embedder = SentenceTransformer(self.config.transformer_model)
            
            NLPAnalyzerComponent._models_loaded = True
            logger.info("✅ NLP Models Loaded Successfully.")
        
        # Assign shared models to instance for easy access
        self.whisper_model = NLPAnalyzerComponent._whisper_model
        self.nlp_spacy = NLPAnalyzerComponent._nlp_spacy
        self.embedder = NLPAnalyzerComponent._embedder
        
        # Instance variable for current audio processing
        self.audio_path = None
        
        logger.info("NLPAnalyzerComponent Initialized.")

    # ==========================================================
    # 🎤 HELPER: LOAD & TRANSCRIBE
    # ==========================================================
    def _load_audio(self):
        """Loads audio using Librosa."""
        y, sr = librosa.load(self.audio_path, sr=None)
        duration = librosa.get_duration(y=y, sr=sr)
        return y, sr, duration

    def _transcribe_audio(self):
        """Transcribes audio using local Whisper (training upload only)."""
        kwargs = {
            "language": self.config.whisper_language,
            "word_timestamps": True,
            "condition_on_previous_text": False,
            "temperature": 0.0,
        }
        prompt = (getattr(self.config, "whisper_initial_prompt", None) or "").strip()
        if prompt:
            kwargs["initial_prompt"] = prompt
        return self.whisper_model.transcribe(self.audio_path, **kwargs)

    def _groq_configured(self) -> bool:
        provider = (getattr(self.config, "answer_stt_provider", "groq") or "groq").lower()
        api_key = (os.getenv("GROQ_API_KEY") or "").strip()
        return provider == "groq" and bool(api_key) and not api_key.startswith("your_")

    def _transcribe_answer(self) -> tuple[dict, str]:
        """
        Answer ASR: Groq only (text + word timestamps). No local Whisper fallback.
        Training upload still uses local Whisper via _transcribe_audio /transcribe.
        Returns (whisper_like_transcript_dict, stt_source).
        """
        if not self._groq_configured():
            raise RuntimeError(
                "Answer STT requires Groq. Set ANSWER_STT_PROVIDER=groq and a valid GROQ_API_KEY."
            )

        try:
            transcript = transcribe_with_groq(
                self.audio_path,
                api_key=(os.getenv("GROQ_API_KEY") or "").strip(),
                model=getattr(self.config, "groq_stt_model", "whisper-large-v3-turbo"),
                language=self.config.whisper_language,
                prompt=getattr(self.config, "whisper_initial_prompt", "") or "",
                with_word_timestamps=True,
            )
        except Exception as e:
            logger.error("Groq STT failed for answer: %s", e)
            raise RuntimeError(f"Groq STT failed: {e}") from e

        text = (transcript.get("text") or "").strip()
        words = sum(len(s.get("words") or []) for s in transcript.get("segments") or [])
        if not text:
            raise RuntimeError(
                "Groq STT returned empty transcript. Check mic audio and try again."
            )
        if words < 2:
            logger.warning(
                "Groq returned text but few word timestamps (%s); using Groq text.",
                words,
            )
        return transcript, "groq"

    def _count_lexical_fillers(self, text: str) -> int:
        tokens = _tokenize_words(text)
        count = 0
        for tok in tokens:
            norm = tok.lower().strip(".,!?;:\"'()[]{}۔؟،")
            if norm in _FILLER_TOKENS:
                count += 1
        return count

    # ==========================================================
    # 📊 HELPER: METRICS EXTRACTION
    # ==========================================================
    def _temporal_hesitation_metrics(self, words):
        gaps = []
        for i in range(len(words) - 1):
            gap = words[i+1]["start"] - words[i]["end"]
            if gap > 0:
                gaps.append(gap)

        long_pauses = [g for g in gaps if g > self.config.pause_threshold]

        pause_density = len(long_pauses) / max(len(words), 1)
        pause_variance = np.std(gaps) if gaps else 0.0

        return {
            "pause_density": _json_float(pause_density, 3),
            "pause_variance": _json_float(pause_variance, 3),
            "long_pause_count": len(long_pauses),
        }

    def _extract_speech_metrics(self, transcript, duration, answer_text: str = ""):
        words = []
        for seg in transcript.get("segments") or []:
            words.extend(seg.get("words") or [])

        # Ensure numeric start/end
        cleaned = []
        for w in words:
            try:
                cleaned.append(
                    {
                        "word": w.get("word", ""),
                        "start": float(w["start"]),
                        "end": float(w["end"]),
                    }
                )
            except (KeyError, TypeError, ValueError):
                continue
        words = cleaned

        if len(words) < 2:
            # Fall back to duration-only WPM from tokenized text when timestamps missing.
            text = (answer_text or transcript.get("text") or "").strip()
            token_count = max(len(_tokenize_words(text)), 1)
            lexical_count = self._count_lexical_fillers(text)
            lexical_rate = lexical_count / token_count
            wpm = token_count / max(duration / 60, 1e-6) if duration else 0.0
            return {
                "speech_rate_wpm": _json_float(wpm, 2),
                "pause_ratio": 0.0,
                "avg_pause_duration": 0.0,
                "silence_to_speech_ratio": 0.0,
                "filler_rate": _json_float(lexical_rate, 3),
                "pause_filler_rate": 0.0,
                "lexical_filler_rate": _json_float(lexical_rate, 3),
                "lexical_filler_count": lexical_count,
                "rhythm_stability": 0.0,
                "pause_density": 0.0,
                "pause_variance": 0.0,
            }, words

        total_words = len(words)
        speech_rate_wpm = total_words / (duration / 60) if duration else 0.0

        pauses = []
        for i in range(len(words) - 1):
            gap = words[i + 1]["start"] - words[i]["end"]
            if gap > 0:
                pauses.append(gap)

        long_pauses = [p for p in pauses if p > self.config.pause_threshold]
        total_pause_time = sum(pauses)
        pause_ratio = total_pause_time / duration if duration else 0.0
        avg_pause_duration = np.mean(long_pauses) if long_pauses else 0.0
        silence_to_speech_ratio = total_pause_time / max(duration - total_pause_time, 1e-5)

        pause_filler_rate = len(long_pauses) / max(total_words, 1)
        text_for_lex = (answer_text or transcript.get("text") or "").strip()
        lexical_count = self._count_lexical_fillers(text_for_lex)
        lexical_filler_rate = lexical_count / max(total_words, 1)
        # Single UI metric: hesitation pauses + uh/um-style fillers.
        filler_rate = 0.5 * pause_filler_rate + 0.5 * lexical_filler_rate

        inter_word_intervals = [
            words[i + 1]["start"] - words[i]["end"] for i in range(len(words) - 1)
        ]
        rhythm_stability = np.std(inter_word_intervals) if inter_word_intervals else 0.0
        hesitation = self._temporal_hesitation_metrics(words)

        return {
            "speech_rate_wpm": _json_float(speech_rate_wpm, 2),
            "pause_ratio": _json_float(pause_ratio, 3),
            "avg_pause_duration": _json_float(avg_pause_duration, 2),
            "silence_to_speech_ratio": _json_float(silence_to_speech_ratio, 2),
            "filler_rate": _json_float(filler_rate, 3),
            "pause_filler_rate": _json_float(pause_filler_rate, 3),
            "lexical_filler_rate": _json_float(lexical_filler_rate, 3),
            "lexical_filler_count": lexical_count,
            "rhythm_stability": _json_float(rhythm_stability, 3),
            "pause_density": hesitation["pause_density"],
            "pause_variance": hesitation["pause_variance"],
        }, words

    def _syntactic_uncertainty(self, text):
        # English spaCy deps are unreliable on Urdu — skip rather than fake penalties.
        if _looks_like_urdu(text):
            return {
                "aux_verb_ratio": 0.0,
                "subordinate_clause_ratio": 0.0,
            }

        doc = self.nlp_spacy(text)

        aux_verbs = 0
        subordinate_clauses = 0

        for token in doc:
            if token.dep_ == "aux":
                aux_verbs += 1
            if token.dep_ in {"mark", "advcl", "ccomp"}:
                subordinate_clauses += 1

        total_tokens = len(doc)

        return {
            "aux_verb_ratio": _json_float(aux_verbs / max(total_tokens, 1), 3),
            "subordinate_clause_ratio": _json_float(
                subordinate_clauses / max(total_tokens, 1), 3
            ),
        }

    def _semantic_instability(self, sentences):
        if len(sentences) < 2:
            return 0.0

        embeddings = self.embedder.encode(sentences)
        sims = []

        for i in range(len(embeddings) - 1):
            sim = cosine_similarity(
                [embeddings[i]], [embeddings[i+1]]
            )[0][0]
            sims.append(sim)

        return _json_float(1 - np.mean(sims), 3)

    def _question_relevance(self, question_text: str, answer_text: str):
        """Cosine similarity between a reference text and full answer transcript."""
        question = (question_text or "").strip()
        answer = (answer_text or "").strip()

        if not question or not answer:
            return {
                "relevance_score": 0.0,
                "relevance_pct": 0.0,
            }

        q_emb = self.embedder.encode(question, normalize_embeddings=True)
        a_emb = self.embedder.encode(answer, normalize_embeddings=True)
        sim = float(cosine_similarity([q_emb], [a_emb])[0][0])
        sim = max(0.0, min(1.0, sim))

        return {
            "relevance_score": _json_float(sim, 3),
            "relevance_pct": _json_float(sim * 100, 1),
        }

    def _combined_relevance(self, question_relevance, video_relevance, has_training: bool):
        """Blend question + video relevance for quality scoring when training exists."""
        if not has_training:
            return question_relevance
        q = float(question_relevance.get("relevance_score") or 0.0)
        v = float(video_relevance.get("relevance_score") or 0.0)
        avg = (q + v) / 2.0
        return {
            "relevance_score": _json_float(avg, 3),
            "relevance_pct": _json_float(avg * 100, 1),
        }

    def _extract_linguistic_metrics(self, text):
        sentences = _tokenize_sentences(text)
        words = _tokenize_words(text)

        total_words = len(words)
        unique_words = len(set(words))

        lexical_richness = unique_words / max(total_words, 1)

        sentence_lengths = [len(_tokenize_words(s)) for s in sentences]
        sentence_length_std = np.std(sentence_lengths) if sentence_lengths else 0.0

        word_counts = Counter(words)
        repeated_words = sum(c for c in word_counts.values() if c > 1)
        repetition_ratio = repeated_words / max(total_words, 1)

        syntactic = self._syntactic_uncertainty(text)
        semantic_drift = self._semantic_instability(sentences)

        return {
            "lexical_richness": _json_float(lexical_richness, 3),
            "sentence_length_std": _json_float(sentence_length_std, 2),
            "repetition_ratio": _json_float(repetition_ratio, 3),
            "syntactic_uncertainty": syntactic,
            "semantic_instability": semantic_drift,
        }


    def prosodic_confidence(self,y, sr, duration):
        """
        Rule-based deterministic prosodic confidence scorer for interview audio.
        
        Parameters:
            y        : np.ndarray  — audio time series (mono)
            sr       : int         — sample rate
            duration : float       — duration in seconds
        
        Returns:
            dict with 'score' (0–100) and per-feature breakdown
        """

        # ------------------------------------------------------------------ #
        #  SAFETY GUARDS                                                       #
        # ------------------------------------------------------------------ #
        if duration < 1.0 or len(y) < sr:
            return 0.0

        scores = {}

        # ================================================================== #
        # 1. SPEECH RATE  (words-per-minute proxy via syllable detection)     #
        #    Confident speech: 120–180 WPM  (≈2–3 syllables/sec)             #
        #    Too fast → nervous; too slow → unsure                            #
        # ================================================================== #
        hop_length = 512
        rms = librosa.feature.rms(y=y, hop_length=hop_length)[0]
        rms_db = librosa.amplitude_to_db(rms + 1e-6)

        # Rough syllable count: count RMS peaks above threshold
        threshold = np.percentile(rms_db, 40)
        above = (rms_db > threshold).astype(int)
        syllable_crossings = np.sum(np.diff(above) == 1)
        syllable_rate = syllable_crossings / duration  # syllables per second

        if 2.0 <= syllable_rate <= 3.5:
            scores["speech_rate"] = 100
        elif 1.5 <= syllable_rate < 2.0 or 3.5 < syllable_rate <= 4.5:
            scores["speech_rate"] = 70
        elif 1.0 <= syllable_rate < 1.5 or 4.5 < syllable_rate <= 5.5:
            scores["speech_rate"] = 40
        else:
            scores["speech_rate"] = 15

        # ================================================================== #
        # 2. PITCH (F0) STATISTICS                                            #
        #    Confident speakers: moderate pitch, controlled variation         #
        #    Pitch too flat   → monotone / robotic                           #
        #    Pitch too erratic→ nervous / uncertain                          #
        # ================================================================== #
        f0, voiced_flag, _ = librosa.pyin(
            y, fmin=librosa.note_to_hz("C2"), fmax=librosa.note_to_hz("C7"),
            sr=sr, hop_length=hop_length
        )
        voiced_f0 = f0[voiced_flag & ~np.isnan(f0)]

        if len(voiced_f0) < 10:
            scores["pitch_variability"] = 30
            scores["pitch_range"] = 30
        else:
            # Pitch variability (CoV = std/mean)
            pitch_cov = np.std(voiced_f0) / (np.mean(voiced_f0) + 1e-6)
            if 0.08 <= pitch_cov <= 0.25:
                scores["pitch_variability"] = 100
            elif 0.05 <= pitch_cov < 0.08 or 0.25 < pitch_cov <= 0.35:
                scores["pitch_variability"] = 65
            elif pitch_cov < 0.05:
                scores["pitch_variability"] = 30   # monotone
            else:
                scores["pitch_variability"] = 40   # overly erratic

            # Pitch range (semitone span)
            p10, p90 = np.percentile(voiced_f0, 10), np.percentile(voiced_f0, 90)
            semitone_range = 12 * np.log2((p90 + 1e-6) / (p10 + 1e-6))
            if 4 <= semitone_range <= 14:
                scores["pitch_range"] = 100
            elif 2 <= semitone_range < 4 or 14 < semitone_range <= 20:
                scores["pitch_range"] = 65
            else:
                scores["pitch_range"] = 30

        # ================================================================== #
        # 3. VOICED RATIO  (speech vs silence proportion)                     #
        #    Too many pauses → hesitant; too few → no breathing room          #
        # ================================================================== #
        voiced_ratio = np.sum(voiced_flag) / (len(voiced_flag) + 1e-6)

        if 0.55 <= voiced_ratio <= 0.85:
            scores["voiced_ratio"] = 100
        elif 0.40 <= voiced_ratio < 0.55 or 0.85 < voiced_ratio <= 0.92:
            scores["voiced_ratio"] = 65
        elif 0.25 <= voiced_ratio < 0.40:
            scores["voiced_ratio"] = 35   # too many pauses
        else:
            scores["voiced_ratio"] = 20

        # ================================================================== #
        # 4. ENERGY CONSISTENCY  (RMS std / mean)                             #
        #    Confident speakers maintain steady volume                         #
        # ================================================================== #
        rms_linear = librosa.feature.rms(y=y, hop_length=hop_length)[0]
        energy_cov = np.std(rms_linear) / (np.mean(rms_linear) + 1e-6)

        if 0.3 <= energy_cov <= 0.9:
            scores["energy_consistency"] = 100
        elif 0.15 <= energy_cov < 0.3 or 0.9 < energy_cov <= 1.2:
            scores["energy_consistency"] = 65
        elif energy_cov < 0.15:
            scores["energy_consistency"] = 40   # whisper-flat
        else:
            scores["energy_consistency"] = 30   # very erratic volume

        # ================================================================== #
        # 5. PAUSE PATTERN  (long silence detection)                          #
        #    Confident: few long pauses (>1.5 s); short pauses OK             #
        # ================================================================== #
        frame_duration = hop_length / sr          # seconds per frame
        silence_threshold_db = np.percentile(rms_db, 25)
        is_silent = rms_db < silence_threshold_db

        # Find runs of silence
        long_pause_count = 0
        run_len = 0
        long_pause_threshold_frames = int(1.5 / frame_duration)

        for s in is_silent:
            if s:
                run_len += 1
                if run_len == long_pause_threshold_frames:
                    long_pause_count += 1
            else:
                run_len = 0

        pauses_per_minute = long_pause_count / (duration / 60.0 + 1e-6)

        if pauses_per_minute <= 2:
            scores["pause_pattern"] = 100
        elif pauses_per_minute <= 5:
            scores["pause_pattern"] = 75
        elif pauses_per_minute <= 9:
            scores["pause_pattern"] = 45
        else:
            scores["pause_pattern"] = 20

        # ================================================================== #
        # 6. JITTER  (pitch micro-instability, proxy for vocal tremor)        #
        #    Nervous/stressed speakers show more jitter                        #
        # ================================================================== #
        if len(voiced_f0) > 10:
            f0_diff = np.abs(np.diff(voiced_f0))
            jitter = np.mean(f0_diff) / (np.mean(voiced_f0) + 1e-6)
            if jitter < 0.01:
                scores["jitter"] = 100
            elif jitter < 0.03:
                scores["jitter"] = 75
            elif jitter < 0.06:
                scores["jitter"] = 50
            else:
                scores["jitter"] = 20
        else:
            scores["jitter"] = 40

        # ================================================================== #
        # 7. SPECTRAL CENTROID STABILITY  (timbre consistency)                #
        #    Confident voice → stable brightness; anxious → erratic           #
        # ================================================================== #
        centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=hop_length)[0]
        centroid_cov = np.std(centroid) / (np.mean(centroid) + 1e-6)

        if centroid_cov < 0.20:
            scores["spectral_stability"] = 100
        elif centroid_cov < 0.35:
            scores["spectral_stability"] = 75
        elif centroid_cov < 0.55:
            scores["spectral_stability"] = 50
        else:
            scores["spectral_stability"] = 25

        # ================================================================== #
        # WEIGHTED AGGREGATION                                                 #
        # ================================================================== #
        weights = {
            "speech_rate":        0.18,
            "pitch_variability":  0.16,
            "pitch_range":        0.12,
            "voiced_ratio":       0.15,
            "energy_consistency": 0.13,
            "pause_pattern":      0.14,
            "jitter":             0.07,
            "spectral_stability": 0.05,
        }

        final_score = sum(scores[k] * weights[k] for k in weights)
        return _json_float(min(max(final_score, 0), 100), 2)
    # ==========================================================
    # 🏆 SCORING SYSTEM 
    # ==========================================================
    def _compute_phase1_quality_score(
        self, speech, linguistic, prosodic_confidence, question_relevance=None
    ):
        score = 100.0
        cfg = self.config # Short alias
        question_relevance = question_relevance or {}

        # 1. Speech Fluency
        wpm = speech.get("speech_rate_wpm", 0)
        rhythm = speech.get("rhythm_stability", 0)

        if wpm < cfg.wpm_min or wpm > cfg.wpm_max:
            score -= cfg.penalty_wpm_high
        elif wpm < cfg.wpm_strict_min or wpm > cfg.wpm_strict_max:
            score -= cfg.penalty_wpm_med

        if rhythm > cfg.rhythm_stability_high:
            score -= cfg.penalty_rhythm_high
        elif rhythm > cfg.rhythm_stability_med:
            score -= cfg.penalty_rhythm_med

        # 2. Pause & Hesitation
        if speech.get("pause_ratio", 0) > cfg.pause_ratio_high:
            score -= cfg.penalty_pause_ratio_high
        elif speech.get("pause_ratio", 0) > cfg.pause_ratio_med:
            score -= cfg.penalty_pause_ratio_med

        if speech.get("avg_pause_duration", 0) > cfg.avg_pause_high:
            score -= cfg.penalty_avg_pause_high
        elif speech.get("avg_pause_duration", 0) > cfg.avg_pause_med:
            score -= cfg.penalty_avg_pause_med

        if speech.get("filler_rate", 0) > cfg.filler_rate_high:
            score -= cfg.penalty_filler_high
        elif speech.get("filler_rate", 0) > cfg.filler_rate_med:
            score -= cfg.penalty_filler_med

        # 3. Linguistic Clarity
        if linguistic.get("lexical_richness", 0) < cfg.lexical_richness_low:
            score -= cfg.penalty_lexical_high
        elif linguistic.get("lexical_richness", 0) < cfg.lexical_richness_med:
            score -= cfg.penalty_lexical_med

        if linguistic.get("repetition_ratio", 0) > cfg.repetition_ratio_high:
            score -= cfg.penalty_repetition_high
        elif linguistic.get("repetition_ratio", 0) > cfg.repetition_ratio_med:
            score -= cfg.penalty_repetition_med

        # 4. Structural Stability
        if linguistic.get("sentence_length_std", 0) > cfg.sentence_length_std_high:
            score -= cfg.penalty_sent_std_high
        elif linguistic.get("sentence_length_std", 0) > cfg.sentence_length_std_med:
            score -= cfg.penalty_sent_std_med

        if linguistic["syntactic_uncertainty"]["aux_verb_ratio"] > cfg.aux_verb_ratio_high:
            score -= cfg.penalty_aux_verb

        if linguistic["semantic_instability"] > cfg.semantic_instability_high:
            score -= cfg.penalty_semantic_high
        elif linguistic["semantic_instability"] > cfg.semantic_instability_med:
            score -= cfg.penalty_semantic_med

        # 5. Prosodic Confidence (Acoustic/DSP Impact)
        # Assuming prosodic_confidence is a 0-100 float from your new function
        if prosodic_confidence < cfg.prosodic_confidence_low:
            score -= cfg.penalty_prosodic_high
        elif prosodic_confidence < cfg.prosodic_confidence_med:
            score -= cfg.penalty_prosodic_med

        # 6. Question–answer relevance (semantic alignment to prompt)
        rel = question_relevance.get("relevance_score", 1.0)
        if rel < cfg.relevance_low:
            score -= cfg.penalty_relevance_high
        elif rel < cfg.relevance_med:
            score -= cfg.penalty_relevance_med

        if rel < cfg.relevance_cap_threshold:
            score = min(score, cfg.relevance_score_cap)

        return _json_float(max(0, min(score, 100)), 1)

# ==========================================================
    # 🚀 MAIN RUNNER
    # ==========================================================
    def run(self, audio_path_str: str, question_text: str = "", training_text: str = ""):
        """
        Executes Phase-1 linguistic & speech analysis.
        Args:
            audio_path_str (str): Path to the audio file.
            question_text (str): Full question prompt for relevance scoring.
            training_text (str): Training video transcript for video relevance scoring.
        """
        self.audio_path = str(audio_path_str) # Set path for this run
        
        logger.info(f"Running NLP Analysis for: {Path(self.audio_path).name}...")

        try:
            y, sr, duration = self._load_audio()
            # Answers: Groq only. Training upload uses local Whisper via /transcribe.
            transcript, stt_source = self._transcribe_answer()
            text = (transcript.get("text") or "").strip()

            if not text:
                logger.warning("Transcript is empty. Returning default metrics.")
                return {"error": "Empty transcript", "score": 0}

            speech_metrics, words = self._extract_speech_metrics(
                transcript, duration, answer_text=text
            )
            linguistic_metrics = self._extract_linguistic_metrics(text)
            prosodic_confidence_score = self.prosodic_confidence(y, sr, duration)
            question_relevance = self._question_relevance(question_text, text)
            has_training = bool((training_text or "").strip())
            video_relevance = (
                self._question_relevance(training_text, text)
                if has_training
                else {"relevance_score": 0.0, "relevance_pct": 0.0}
            )
            scoring_relevance = self._combined_relevance(
                question_relevance, video_relevance, has_training
            )

            phase1_score = self._compute_phase1_quality_score(
                speech=speech_metrics,
                linguistic=linguistic_metrics,
                prosodic_confidence=prosodic_confidence_score,
                question_relevance=scoring_relevance,
            )

            logger.info(
                f"NLP Analysis Complete. Score: {phase1_score}/100 "
                f"(question: {question_relevance.get('relevance_pct', 0)}%, "
                f"video: {video_relevance.get('relevance_pct', 0)}%, "
                f"stt: {stt_source})"
            )

            return {
                "transcript": text,
                "stt_source": stt_source,
                "speech_metrics": speech_metrics,
                "linguistic_metrics": linguistic_metrics,
                "question_relevance": question_relevance,
                "video_relevance": video_relevance,
                "phase1_quality_score": phase1_score,
                "prosodic_confidence": prosodic_confidence_score,
                "phase": "phase_1",
                "version": "v1.4",
            }
            
        except Exception as e:
            logger.error(f"NLP Analysis Failed: {e}")
            raise e