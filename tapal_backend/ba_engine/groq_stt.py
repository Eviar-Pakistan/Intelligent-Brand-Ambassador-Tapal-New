"""Groq Whisper STT for answer transcripts (text + word timestamps)."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx

from ba_engine.logger import logger

GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions"


def _mime_for(path: Path) -> str:
    return {
        ".wav": "audio/wav",
        ".webm": "audio/webm",
        ".mp3": "audio/mpeg",
        ".mp4": "audio/mp4",
        ".m4a": "audio/mp4",
        ".ogg": "audio/ogg",
        ".flac": "audio/flac",
    }.get(path.suffix.lower(), "application/octet-stream")


def _normalize_words(raw_words: list | None) -> list[dict[str, Any]]:
    words = []
    for w in raw_words or []:
        if not isinstance(w, dict):
            continue
        start = w.get("start")
        end = w.get("end")
        if start is None or end is None:
            continue
        words.append(
            {
                "word": str(w.get("word") or w.get("text") or "").strip(),
                "start": float(start),
                "end": float(end),
            }
        )
    return words


def groq_payload_to_whisper_transcript(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Normalize Groq verbose_json into the segment/words shape used by local Whisper.
    """
    text = (payload.get("text") or "").strip()
    top_words = _normalize_words(payload.get("words"))
    segments_out = []

    for seg in payload.get("segments") or []:
        if not isinstance(seg, dict):
            continue
        seg_words = _normalize_words(seg.get("words"))
        segments_out.append(
            {
                "start": float(seg.get("start") or 0.0),
                "end": float(seg.get("end") or 0.0),
                "text": (seg.get("text") or "").strip(),
                "words": seg_words,
            }
        )

    if top_words and not any(s.get("words") for s in segments_out):
        segments_out = [
            {
                "start": top_words[0]["start"],
                "end": top_words[-1]["end"],
                "text": text,
                "words": top_words,
            }
        ]
    elif top_words and segments_out and not any(s.get("words") for s in segments_out):
        # Attach top-level words into one bucket if segments lack words.
        segments_out[0]["words"] = top_words

    return {"text": text, "segments": segments_out}


def transcribe_with_groq(
    audio_path: str,
    *,
    api_key: str,
    model: str = "whisper-large-v3-turbo",
    language: str = "ur",
    prompt: str = "",
    timeout_s: float = 120.0,
    with_word_timestamps: bool = True,
) -> dict[str, Any]:
    """
    Transcribe via Groq Whisper.
    Returns a Whisper-like dict: {text, segments:[{words:[{word,start,end}]}]}
    """
    path = Path(audio_path)
    if not path.is_file():
        raise FileNotFoundError(f"Audio not found: {audio_path}")

    headers = {"Authorization": f"Bearer {api_key}"}

    # httpx: when uploading a file, put ALL non-file fields in `files` as
    # (None, value). Mixing data=list[tuple] + files= breaks multipart encoding
    # ("expected a bytes-like object, tuple found").
    multipart: list[tuple[str, Any]] = [
        ("model", (None, model)),
        ("language", (None, language)),
        ("temperature", (None, "0")),
    ]
    if prompt.strip():
        multipart.append(("prompt", (None, prompt.strip())))

    if with_word_timestamps:
        multipart.append(("response_format", (None, "verbose_json")))
        multipart.append(("timestamp_granularities[]", (None, "word")))
        multipart.append(("timestamp_granularities[]", (None, "segment")))
    else:
        multipart.append(("response_format", (None, "json")))

    with path.open("rb") as f:
        multipart.append(("file", (path.name, f, _mime_for(path))))
        with httpx.Client(timeout=timeout_s) as client:
            res = client.post(
                GROQ_TRANSCRIBE_URL,
                headers=headers,
                files=multipart,
            )

    if res.status_code >= 400:
        detail = res.text[:500]
        logger.error("Groq STT failed (%s): %s", res.status_code, detail)
        res.raise_for_status()

    payload = res.json() if res.content else {}
    transcript = groq_payload_to_whisper_transcript(payload)
    word_count = sum(len(s.get("words") or []) for s in transcript.get("segments") or [])
    logger.info(
        "Groq STT ok (%s chars, %s words, model=%s)",
        len(transcript.get("text") or ""),
        word_count,
        model,
    )
    return transcript


def transcribe_text_with_groq(*args, **kwargs) -> str:
    """Back-compat helper: return text only."""
    return (transcribe_with_groq(*args, **kwargs).get("text") or "").strip()
