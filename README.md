# Transcriber

A Next.js audio transcription app with a modern UI. Upload single or multiple audio files, choose your STT provider and model from the UI, and get transcripts as background jobs complete.

## Stack

- **Next.js 16** (App Router)
- **Sequelize** + **PostgreSQL**
- **Providers**: Soniox, Deepgram

## Quick start (local dev)

For local development you can optionally start Postgres with Docker:

```bash
docker compose up -d
```

### 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and add API keys for the providers you plan to use:

```env
DATABASE_URL=postgresql://transcriber:transcriber@localhost:5432/transcriber
SONIOX_API_KEY=your_key
DEEPGRAM_API_KEY=your_key
```

### 2. Sync database & seed keyterms

```bash
npm run db:sync
npm run db:seed
```

`db:seed` loads **166 domain keyterms** from IT_Curves_Bot (`src/data/keyterms.json`) into default app settings.

### 3. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production deployment

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for full server setup at `https://transcriber.sangahub.com`.

## Features

- Upload one or many audio files (mp3, wav, m4a, flac, ogg, webm)
- Choose provider and model from the UI
- Toggle speaker diarization (Agent/Caller dialogue format)
- Custom keyterms for better accuracy
- Background processing — jobs continue after upload
- Live status updates on the jobs panel
- Copy transcript, retry failed jobs, delete jobs

## API routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/upload` | POST | Upload audio files and enqueue jobs |
| `/api/jobs` | GET | List all transcription jobs |
| `/api/jobs/[id]` | GET/DELETE | Get or delete a job |
| `/api/jobs/[id]/retry` | POST | Retry a failed job |
| `/api/providers` | GET | List providers and configuration status |
| `/api/settings` | GET/PUT | Default transcription settings |

## Project structure

```
src/
  app/           # Next.js pages and API routes
  components/    # UI components
  lib/
    models/      # Sequelize models
    transcription/  # Provider implementations
    queue.ts     # Background job processor
```
