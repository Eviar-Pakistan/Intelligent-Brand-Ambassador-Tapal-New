"""
In-process BA Linguistic NLP engine (vendored as tapal_backend/ba_engine).

No separate FastAPI/uvicorn process — Django calls Whisper/NLP directly so
the whole product deploys as one project.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from django.conf import settings


class EngineError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


_analyzer = None
_ffmpeg_exe: str | None = None


def _json_safe(value):
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, (np.floating, np.integer)):
        return value.item()
    if isinstance(value, np.ndarray):
        return value.tolist()
    return value


def _resolve_ffmpeg() -> str:
    """Prefer system ffmpeg; fall back to imageio-ffmpeg bundled binary."""
    global _ffmpeg_exe
    if _ffmpeg_exe:
        return _ffmpeg_exe

    found = shutil.which('ffmpeg')
    if found:
        _ffmpeg_exe = found
        return _ffmpeg_exe

    try:
        import imageio_ffmpeg

        found = imageio_ffmpeg.get_ffmpeg_exe()
        if found and Path(found).exists():
            _ffmpeg_exe = found
            return _ffmpeg_exe
    except Exception:
        pass

    raise EngineError(
        'ffmpeg not found. Install ffmpeg on PATH, or: pip install imageio-ffmpeg',
        500,
    )


def _ensure_wav(src: Path) -> Path:
    if src.suffix.lower() == '.wav':
        return src
    out = src.with_suffix('.wav')
    ffmpeg = _resolve_ffmpeg()
    cmd = [
        ffmpeg,
        '-y',
        '-i',
        str(src),
        '-vn',
        '-acodec',
        'pcm_s16le',
        '-ar',
        '16000',
        '-ac',
        '1',
        str(out),
    ]
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except FileNotFoundError as e:
        raise EngineError(
            'ffmpeg not found. Install ffmpeg on PATH, or: pip install imageio-ffmpeg',
            500,
        ) from e
    except subprocess.CalledProcessError as e:
        err = e.stderr.decode('utf-8', errors='ignore') if e.stderr else str(e)
        raise EngineError(f'Audio conversion failed: {err}', 400) from e
    return out


def _get_analyzer():
    """Lazy-load NLP models once per process."""
    global _analyzer
    if _analyzer is not None:
        return _analyzer

    try:
        from ba_engine.config import NLPConfig
        from ba_engine.nlp_analyzer import NLPAnalyzerComponent
    except ImportError as e:
        raise EngineError(
            'BA NLP engine package missing. Install backend requirements '
            '(whisper, spacy, sentence-transformers, etc.).',
            500,
        ) from e

    # Prefer Django/settings env for Groq STT
    if getattr(settings, 'GROQ_API_KEY', None):
        os.environ.setdefault('GROQ_API_KEY', settings.GROQ_API_KEY)

    cfg = NLPConfig()
    provider = (
        os.getenv('ANSWER_STT_PROVIDER') or cfg.answer_stt_provider or 'groq'
    ).strip().lower()
    cfg.answer_stt_provider = 'groq' if provider else 'groq'
    model = (os.getenv('GROQ_STT_MODEL') or cfg.groq_stt_model or '').strip()
    if model:
        cfg.groq_stt_model = model

    _analyzer = NLPAnalyzerComponent(cfg)
    return _analyzer


def engine_health() -> str:
    try:
        _get_analyzer()
        return 'ok'
    except Exception:
        return 'down'


def transcribe_media(
    file_path: str | Path,
    original_name: str = 'video.mp4',
    content_type: str = 'video/mp4',
) -> str:
    """Extract speech from training video. Prefer Groq STT; fall back to local Whisper."""
    del content_type
    path = Path(file_path)
    if not path.exists():
        raise EngineError('Training video file missing on disk.', 404)

    suffix = Path(original_name or path.name).suffix or path.suffix or '.mp4'
    with tempfile.TemporaryDirectory() as tmp:
        raw_path = Path(tmp) / f'upload{suffix}'
        raw_path.write_bytes(path.read_bytes())
        try:
            wav_path = _ensure_wav(raw_path)
        except EngineError:
            raise
        except Exception as e:
            raise EngineError(f'Audio extraction failed: {e}', 500) from e

        text = ''
        errors: list[str] = []

        # 1) Groq (same key as answer STT) — reliable and fast for training audio
        api_key = (getattr(settings, 'GROQ_API_KEY', None) or os.getenv('GROQ_API_KEY') or '').strip()
        if api_key and not api_key.startswith('your_'):
            try:
                from ba_engine.config import NLPConfig
                from ba_engine.groq_stt import transcribe_with_groq

                cfg = NLPConfig()
                result = transcribe_with_groq(
                    str(wav_path),
                    api_key=api_key,
                    model=os.getenv('GROQ_STT_MODEL')
                    or getattr(settings, 'GROQ_STT_MODEL', None)
                    or cfg.groq_stt_model,
                    language=cfg.whisper_language,
                    prompt=getattr(cfg, 'whisper_initial_prompt', '') or '',
                    with_word_timestamps=False,
                    timeout_s=300.0,
                )
                text = (result.get('text') or '').strip()
            except Exception as e:
                errors.append(f'Groq: {e}')

        # 2) Local Whisper fallback
        if not text:
            try:
                analyzer = _get_analyzer()
                analyzer.audio_path = str(wav_path)
                result = analyzer._transcribe_audio()
                text = (result.get('text') or '').strip()
            except Exception as e:
                errors.append(f'Whisper: {e}')

    if not text:
        detail = '; '.join(errors) if errors else 'no speech detected'
        raise EngineError(
            f'Transcription returned empty text ({detail}). '
            'Check the video has clear speech and GROQ_API_KEY is set.',
            422,
        )
    return text


def analyze_audio(
    file_path: str | Path,
    *,
    question_id: str,
    question_title: str,
    question_description: str,
    training_script: str,
    original_name: str = 'answer.webm',
    content_type: str = 'audio/webm',
) -> dict:
    del content_type
    path = Path(file_path)
    if not path.exists():
        raise EngineError('Audio file missing on disk.', 404)

    suffix = Path(original_name or path.name).suffix or path.suffix or '.webm'
    with tempfile.TemporaryDirectory() as tmp:
        raw_path = Path(tmp) / f'upload{suffix}'
        raw_path.write_bytes(path.read_bytes())
        try:
            from ba_engine.affect_proxy import estimate_affect

            wav_path = _ensure_wav(raw_path)
            question_prompt = f'{question_title}. {question_description}'.strip().strip('.')
            nlp = _get_analyzer().run(
                str(wav_path),
                question_text=question_prompt,
                training_text=training_script or '',
            )
        except EngineError:
            raise
        except Exception as e:
            raise EngineError(f'Engine analysis failed: {e}', 500) from e

        if not isinstance(nlp, dict) or nlp.get('error'):
            msg = nlp.get('error', 'NLP analysis failed') if isinstance(nlp, dict) else 'NLP failed'
            raise EngineError(str(msg), 422)

        affect = estimate_affect(
            speech=nlp.get('speech_metrics') or {},
            linguistic=nlp.get('linguistic_metrics') or {},
            prosodic_confidence=nlp.get('prosodic_confidence'),
        )
        speech = nlp.get('speech_metrics') or {}

        return _json_safe(
            {
                'question_id': question_id,
                'question_title': question_title,
                'question_description': question_description,
                'transcript': nlp.get('transcript', ''),
                'stt_source': nlp.get('stt_source', 'groq'),
                'communication_quality': nlp.get('phase1_quality_score', 0),
                'speaking_speed_wpm': speech.get('speech_rate_wpm', 0),
                'filler_rate': speech.get('filler_rate', 0),
                'nervousness_pct': affect['nervousness_pct'],
                'dominant_mood': affect['dominant_mood'],
                'affect_breakdown': affect['breakdown'],
                'speech_metrics': speech,
                'linguistic_metrics': nlp.get('linguistic_metrics') or {},
                'question_relevance': nlp.get('question_relevance') or {},
                'video_relevance': nlp.get('video_relevance') or {},
                'prosodic_confidence': nlp.get('prosodic_confidence'),
                'analysis_mode': 'audio_nlp_prosody',
                'brand': getattr(settings, 'BRAND_NAME', 'Tapal'),
            }
        )
