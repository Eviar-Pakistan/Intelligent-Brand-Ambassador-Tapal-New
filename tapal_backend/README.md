# Tapal Brand Ambassador — single project

## What runs

| Piece | How |
|-------|-----|
| React UI | `npm run dev` (Vite :5173) |
| Django API + BA NLP | `python manage.py runserver` (:8000) |

Training video transcription and BA answer scoring use **`tapal_backend/ba_engine`** inside Django.
You do **not** need `E:\tapal BA Linguistic` or a separate uvicorn :8100 process.

## Backend setup

```bash
cd tapal_backend
python -m venv .venv
.venv\Scripts\activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
python -m spacy download en_core_web_sm
python manage.py migrate
python manage.py runserver
```

System requirement: **ffmpeg** on PATH.

Put `GROQ_API_KEY` in the repo-root `.env` (answer speech-to-text). Training video ASR uses local Whisper.

## Frontend

```bash
npm install
npm run dev
```

## Deploy note

Ship **one** backend (Django + vendored `ba_engine`) and **one** frontend build. No Express or FastAPI sidecar.
