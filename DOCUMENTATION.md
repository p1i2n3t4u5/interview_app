# AI Interview Assistant Platform — Complete Documentation

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [Architecture & System Design](#2-architecture--system-design)
3. [AWS Services Used](#3-aws-services-used)
4. [LLM Models Used](#4-llm-models-used)
5. [API Endpoints Reference](#5-api-endpoints-reference)
6. [Frontend Architecture](#6-frontend-architecture)
7. [Proctoring System](#7-proctoring-system)
8. [Database Design](#8-database-design)
9. [Security & Anti-Cheating](#9-security--anti-cheating)
10. [Cost Analysis](#10-cost-analysis)
11. [Market Comparison](#11-market-comparison)
12. [Setup & Deployment](#12-setup--deployment)
13. [Future Improvements](#13-future-improvements)

---

## 1. Platform Overview

The AI Interview Assistant is a full-stack, AI-powered technical interview platform that automates the entire hiring pipeline: from resume parsing to conducting live interviews with real-time proctoring, answer analysis, and candidate scoring.

### Key Capabilities

| Feature | Description |
|---------|-------------|
| Resume Parsing | Upload PDF resumes, extract skills/experience via LLM |
| JD Matching | Upload job descriptions, match against candidate skills |
| Gap Analysis | AI-generated skill gap report between resume and JD |
| AI Interview | Full conversational interview via WebSocket with voice |
| Voice Synthesis | AI interviewer speaks questions using neural TTS |
| Speech Recognition | Browser-based speech-to-text for candidate answers |
| Answer Analysis | Real-time scoring, authenticity checking, AI-detection |
| Proctoring | Video recording, face tracking, eye tracking, object detection |
| Photo Capture | Random photo snapshots uploaded to S3 during interview |
| Red Flag Detection | AI-generated answers, copy-paste, low authenticity |
| Candidate Ranking | Multi-candidate comparison and ranking |
| Knowledge Base (RAG) | FAISS-based retrieval-augmented generation for question quality |
| Email Invitations | SMTP-based interview invitation emails with unique tokens |
| Interview Reports | Detailed per-candidate interview analysis reports |

### Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Python 3.9, FastAPI, Uvicorn (ASGI) |
| Frontend | Vanilla HTML/CSS/JavaScript |
| Database | TinyDB (file-based JSON) |
| AI/ML | AWS Bedrock (Claude), face-api.js, TensorFlow.js, COCO-SSD |
| Cloud | AWS S3, AWS Polly, AWS Bedrock |
| Email | SMTP (configurable) |
| Vector Search | FAISS (CPU) |

### File Structure

```
interview_app/
├── interview_app.py        # Main backend (1796 lines) — all API endpoints, WebSocket, LLM integration
├── db.json                 # TinyDB database (candidates, interview tokens)
├── questions.json          # Question bank
├── requirements.txt        # Python dependencies
├── .env                    # Environment configuration (AWS keys, SMTP, S3, etc.)
├── info.md                 # Quick-start guide
├── DOCUMENTATION.md        # This file
├── knowledge_files/        # RAG knowledge base files
├── uploads/                # Uploaded resumes and JDs
├── transcripts/            # Interview transcript exports
├── sample_files_test/      # Sample test files (resume.txt, job_description.txt)
└── ui/
    ├── index.html          # Main dashboard page
    ├── app.js              # Dashboard frontend logic
    ├── style.css           # Dashboard styles
    ├── interview.html      # Interview session page (164 lines)
    ├── interview.js        # Interview frontend logic (470 lines)
    ├── interview.css       # Interview styles (528 lines)
    └── proctor.js          # Proctoring module (525 lines)
```

---

## 2. Architecture & System Design

### High-Level Flow

```
Recruiter Flow:
  Upload Resume (PDF) → LLM parses skills → Store in TinyDB
  Upload JD (PDF) → LLM parses requirements → Store in TinyDB
  Gap Analysis → LLM compares resume vs JD → Score + gaps
  Send Email → Generate unique token → SMTP invitation

Candidate Flow:
  Click invite link → Validate token → Enable camera/mic → Read rules
  Start Interview → WebSocket connection → AI greeting (voice)
  Q&A Loop: AI asks question (voice) → Candidate answers (speech/text)
           → LLM analyzes + scores → AI asks next question
  Complete → Final score → Transcript saved → Token expired

Proctoring (parallel):
  Video recording → S3 backup every 30s → Final upload on complete
  Face detection (500ms) → Eye tracking → Look-away detection
  Object detection (3s) → Phone/book/screen detection
  Lip sync analysis → Proxy interview detection
  Flagged snapshots → S3 upload with timestamps
```

### WebSocket Interview Flow (Detailed)

```
Client                          Server
  |                                |
  |--- WebSocket Connect -------->|
  |<-- {"type":"connected"} ------|  (instant ack)
  |                                |
  |    [Server generates greeting + first question in PARALLEL via LLM]
  |    [Server synthesizes greeting audio via Polly]
  |                                |
  |<-- {"type":"greeting"} -------|  (with audio, text, total_questions)
  |                                |
  |--- {"type":"answer"} -------->|  (candidate introduction)
  |                                |
  |    [Loop: question_number 1..N]
  |    [Server synthesizes question audio]
  |                                |
  |<-- {"type":"question"} -------|  (with audio, text, skill, difficulty)
  |                                |
  |--- {"type":"answer"} -------->|  (candidate answer, truncated to 3000 chars)
  |                                |
  |    [LLM analyzes answer: score, authenticity, AI-detection]
  |    [LLM generates next question based on performance]
  |    [Red flags saved to DB if detected]
  |                                |
  |<-- {"type":"complete"} -------|  (after all questions)
  |                                |
  |--- WebSocket Close ---------->|
```

---

## 3. AWS Services Used

### 3.1 Amazon Bedrock (LLM)

**What**: Managed service for foundation models (Claude by Anthropic).
**Why**: No need to host/manage GPU instances. Pay-per-token pricing. Enterprise-grade security. Access to latest Claude models.
**How**: Via `boto3` `bedrock-runtime` client. All LLM calls use `invoke_model` API.

| Use Case | Model | Purpose |
|----------|-------|---------|
| Resume parsing | Claude 3.5 Sonnet v2 | Extract structured data from resume text |
| JD parsing | Claude 3.5 Sonnet v2 | Extract requirements from job descriptions |
| Gap analysis | Claude 3.5 Sonnet v2 | Compare candidate skills vs JD requirements |
| Greeting generation | Claude 3.5 Sonnet v2 | Generate warm, personalized interview greeting |
| Question generation | Claude 3.5 Sonnet v2 | Generate contextual, adaptive interview questions |
| **Answer analysis** | **Claude Sonnet 4** | **Deep analysis: scoring, AI-detection, authenticity** |
| Interview report | Claude 3.5 Sonnet v2 | Generate detailed evaluation reports |
| Candidate ranking | Claude 3.5 Sonnet v2 | Compare and rank multiple candidates |
| Candidate comparison | Claude 3.5 Sonnet v2 | Side-by-side candidate comparison |
| Transcript analysis | Claude 3.5 Sonnet v2 | Analyze submitted interview transcripts |

**Configuration**:
```python
MODEL_ID = "us.anthropic.claude-3-5-sonnet-20241022-v2:0"          # General tasks
ANALYSIS_MODEL_ID = "us.anthropic.claude-sonnet-4-20250514-v1:0"   # Answer analysis (configurable via env)
```

### 3.2 Amazon Polly (Text-to-Speech)

**What**: Neural text-to-speech service.
**Why**: Natural-sounding AI interviewer voice. Neural engine produces human-like speech. Low latency for real-time interviews.
**How**: Via `boto3` `polly` client. Synthesizes MP3 audio from question text.

**Configuration**:
```python
polly.synthesize_speech(
    Text=text,
    OutputFormat="mp3",
    VoiceId="Matthew",      # Male US English voice
    Engine="neural"          # Neural engine for natural speech
)
```

**Used in**:
- Interview greeting (spoken welcome)
- Each interview question (spoken question)
- Interview completion message (spoken goodbye)

### 3.3 Amazon S3 (Object Storage)

**What**: Scalable object storage.
**Why**: Durable, low-cost storage for interview media. Presigned URLs for secure, time-limited access.
**How**: Via `boto3` `s3` client. Auto-creates buckets on startup.

| Bucket | Content | Purpose |
|--------|---------|---------|
| `interview-photos` (S3_BUCKET) | JPEG photos | Random photo captures during interview |
| `ai-interview-assistant-recordings` (S3_INTERVIEW_BUCKET) | WebM videos, JPEG snapshots | Interview video recordings, proctoring flag snapshots |

**S3 Operations**:
- `put_object` — Upload photos, video chunks, snapshots, final videos
- `generate_presigned_url` — Generate time-limited access URLs (1 hour expiry)
- `head_bucket` / `create_bucket` — Auto-create buckets on server startup

**S3 Key Patterns**:
```
photos/{candidate_id}/{timestamp}_{flag}.jpg          # Random photo captures
interviews/{token}/backup_{timestamp}.webm            # Video backups (every 30s)
interviews/{token}/final_{timestamp}.webm             # Complete interview video
interviews/{token}/flags/{timestamp}_{flag_type}.jpg  # Proctoring flag snapshots
```

---

## 4. LLM Models Used

### 4.1 Claude 3.5 Sonnet v2 (General Tasks)

**Model ID**: `us.anthropic.claude-3-5-sonnet-20241022-v2:0`
**Used for**: Resume parsing, JD parsing, gap analysis, greeting, question generation, reports, ranking

**Why this model**:
- Fast response times (~1-3 seconds) — critical for real-time interview flow
- Strong instruction-following for structured JSON output
- Cost-effective for high-volume operations
- Good balance of quality and speed

**Configuration**:
```json
{
  "anthropic_version": "bedrock-2023-05-31",
  "max_tokens": 1000,
  "temperature": 0.2
}
```

### 4.2 Claude Sonnet 4 (Answer Analysis)

**Model ID**: `us.anthropic.claude-sonnet-4-20250514-v1:0`
**Used for**: Answer scoring, AI-generated content detection, authenticity analysis, copy-paste detection

**Why this model**:
- Superior reasoning capabilities — better at detecting subtle patterns of AI-generated text
- Enhanced analytical depth for authenticity verification
- Better at comparing answer style consistency across the interview
- Stronger at identifying copy-paste indicators (formatting, structure, tone shifts)
- Configurable via `ANALYSIS_MODEL_ID` environment variable

**Configuration**:
```json
{
  "anthropic_version": "bedrock-2023-05-31",
  "max_tokens": 2000,
  "temperature": 0.3
}
```

### 4.3 Model Selection Rationale

| Criterion | Claude 3.5 Sonnet v2 | Claude Sonnet 4 |
|-----------|---------------------|---------------------|
| Speed | ~1-3s | ~3-6s |
| Reasoning depth | Good | Excellent |
| Cost per 1K tokens | Lower | Higher |
| Use case fit | Fast generation tasks | Deep analysis tasks |
| AI detection | Moderate | Strong |

**Strategy**: Use the faster model for latency-sensitive generation tasks (greeting, questions) and the stronger model for the critical analysis task where accuracy matters more than speed.

---

## 5. API Endpoints Reference

### Recruiter/Admin Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/` | Dashboard UI |
| GET | `/interview` | Interview session page |
| POST | `/upload_resume/{candidate}` | Upload and parse candidate resume (PDF) |
| POST | `/upload_resumes` | Bulk upload multiple resumes |
| POST | `/upload_jd/{candidate}` | Upload and parse job description (PDF) |
| GET | `/gap_analysis/{candidate}` | Generate AI skill gap analysis |
| GET | `/interview_report/{candidate}` | Generate detailed interview evaluation report |
| GET | `/transcript/{candidate}` | Get interview transcript |
| POST | `/submit_transcript/{candidate}` | Submit and analyze manual transcript |
| GET | `/analytics` | Platform-wide analytics dashboard |
| POST | `/upload_knowledge` | Upload knowledge base files for RAG |
| GET | `/knowledge_files` | List uploaded knowledge files |
| POST | `/rank_candidates` | AI-powered candidate ranking |
| GET | `/candidates` | List all candidates |
| GET | `/candidate_comparison` | Side-by-side candidate comparison |
| POST | `/send_email` | Send interview invitation email |
| GET | `/validate_token` | Validate interview invitation token |

### Interview WebSocket

| Protocol | Endpoint | Purpose |
|----------|----------|---------|
| WS | `/ws/interview/{candidate}` | Manual interview WebSocket (legacy) |
| WS | `/ws/ai_interview/{token}` | AI-powered interview with token auth |

### Proctoring & Media Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/upload_photo` | Upload photo capture (base64 JPEG) |
| POST | `/api/upload_video_chunk` | Upload video backup chunk to S3 |
| POST | `/api/upload_snapshot` | Upload flagged proctoring snapshot |
| POST | `/api/upload_final_video` | Upload complete interview video |
| GET | `/api/presigned_url` | Generate presigned URL for S3 object |

---

## 6. Frontend Architecture

### 6.1 Interview Page States

The interview page (`interview.html`) transitions through these states:

```
Loading → Error (if token invalid)
Loading → Permission Request → Rules/Guidelines → Ready → Interview → Complete
```

| State | Element | Description |
|-------|---------|-------------|
| Loading | `#loadingState` | Spinner while validating token |
| Error | `#errorState` | Invalid/expired token message |
| Permission | `#permissionState` | Camera & mic access request + rules/guidelines |
| Ready | `#readyState` | Camera preview, "Start Interview" button |
| Interview | `#interviewState` | Live interview with video, transcript, answer area |
| Complete | `#completeState` | Thank you message |

### 6.2 Pre-Interview Rules & Guidelines

The rules section warns candidates about:
- Tab switching detection (monitored silently)
- Eye tracking and face detection
- Random photo captures
- Total number of questions
- Requirement to stay on the page

### 6.3 Interview UI Components

- **Video Preview**: Live camera feed (sidebar)
- **Transcript Display**: Scrollable chat-style transcript
- **Answer Area**: Unified textarea for speech + text input (5 rows, resizable)
- **Progress Bar**: Dynamic `current / total` progress indicator
- **Status Indicator**: Shows current state (connecting, preparing, speaking, listening, analyzing)

### 6.4 Speech & Text Input (Unified)

The answer input area unifies both speech recognition and text typing into a single textarea:
- **Speech**: Web Speech API (`SpeechRecognition`) fills the textarea in real-time
- **Text**: Candidate can type or paste directly
- **Auto-submit**: After 5 seconds of silence (speech mode), answer auto-submits
- **Manual submit**: Submit button enabled when textarea has content

---

## 7. Proctoring System

### 7.1 Architecture

The `ProctorMonitor` class (`proctor.js`, 525 lines) runs entirely in the browser alongside the interview:

```
ProctorMonitor
├── Video Recording (MediaRecorder API)
│   ├── 5-second chunk collection
│   ├── 30-second backup upload to S3
│   └── Final complete video upload on stop
├── Face Detection (face-api.js @ 500ms intervals)
│   ├── No face detection (candidate left frame)
│   ├── Multiple face detection (third-party assistance)
│   ├── Face position tracking (looking away)
│   ├── Head tilt detection (>15° angle)
│   └── Lip sync analysis (proxy detection)
├── Object Detection (COCO-SSD @ 3-second intervals)
│   ├── Phone detection
│   ├── Book detection
│   ├── Laptop/extra screen detection
│   └── Additional person detection
└── Flag Management
    ├── 15-second cooldown per flag type
    ├── Snapshot capture with red banner overlay
    └── S3 upload with metadata
```

### 7.2 Detection Models

| Model | Library | CDN Source | Purpose | Interval |
|-------|---------|------------|---------|----------|
| TinyFaceDetector | face-api.js (vladmandic) | jsdelivr | Face detection | 500ms |
| FaceLandmark68TinyNet | face-api.js (vladmandic) | jsdelivr | Eye/mouth landmarks | 500ms |
| lite_mobilenet_v2 | COCO-SSD (TensorFlow.js) | jsdelivr | Object detection | 3000ms |

All CDN scripts load with `defer` attribute to avoid blocking page render.

### 7.3 Flag Types

| Flag Type | Trigger | Description |
|-----------|---------|-------------|
| `face_not_visible` | No face for 2+ seconds | Candidate may have left frame |
| `multiple_faces` | 2+ faces detected | Third-party assistance |
| `eyes_looking_away` | Face >30% off-center for 2+ seconds | Looking at another screen |
| `head_tilted` | Head tilt >15° | Unusual posture |
| `lip_sync_mismatch` | Audio active but mouth closed (6/8 checks) | Proxy interview |
| `phone_detected` | COCO-SSD: "cell phone" >50% | Reading from device |
| `book_detected` | COCO-SSD: "book" >50% | Reading answers |
| `extra_screen_detected` | COCO-SSD: "laptop"/"tv"/"monitor" >50% | Using another device |
| `additional_person` | COCO-SSD: 2+ "person" >50% | Third-party in room |
| `tab_switch` | `visibilitychange` event | Candidate switched tabs (silent) |
| `window_blur` | `blur` event | Window lost focus |

### 7.4 Lip Sync / Proxy Detection

Uses mouth aspect ratio (MAR) from 68-point facial landmarks combined with Web Audio API frequency analysis:

```
MAR = mouth_height / mouth_width
mouth_is_open = MAR > 0.25
audio_active = average_frequency > 15

If audio active but mouth closed for 6+ of last 8 checks → FLAG: lip_sync_mismatch
```

This detects scenarios where someone else is speaking for the candidate, or the candidate is playing pre-recorded audio.

### 7.5 Server-Side Red Flags

The backend also detects red flags during answer analysis:

| Red Flag | Trigger |
|----------|---------|
| `ai_generated_answer` | LLM detects AI-generated or copy-pasted content |
| `very_low_score` | Score ≤ 3/10 on any question |
| `authenticity_concern` | Answer doesn't appear authentic |
| `no_depth` | Answer depth is "none" or "very shallow" |

Red flags are saved to the candidate's DB record with timestamps and reasons.

---

## 8. Database Design

### TinyDB Tables

**`candidates` table** — One record per candidate:
```json
{
  "id": "john_doe",
  "name": "John Doe",
  "resume": "full resume text...",
  "parsed": {
    "skills": ["Python", "AWS", "Docker"],
    "experience": [...],
    "education": [...]
  },
  "jd": "full JD text...",
  "jd_parsed": {...},
  "gap_analysis": {...},
  "ai_interview_transcript": [
    {
      "question_number": 1,
      "type": "question",
      "question": "...",
      "answer": "...",
      "skill_area": "python",
      "difficulty": "intermediate",
      "analysis": {
        "score": 7,
        "is_correct": true,
        "appears_authentic": true,
        "ai_generated": false,
        "ai_generated_reason": "",
        "depth": "moderate",
        "strengths": [...],
        "weaknesses": [...],
        "feedback": "..."
      },
      "timestamp": "2026-03-17T10:00:00"
    }
  ],
  "red_flags": [...],
  "proctoring": {
    "flags": [...],
    "video_s3_key": "interviews/token123/final_xxx.webm",
    "video_presigned_url": "https://...",
    "interview_started_at": "..."
  },
  "interview_status": "completed",
  "interview_average_score": 7.5,
  "photo_s3_key": "...",
  "photo_presigned_url": "..."
}
```

**`interview_tokens` table** — One record per interview invitation:
```json
{
  "token": "uuid-string",
  "candidate_id": "john_doe",
  "status": "active",
  "total_questions": 30,
  "created_at": "2026-03-17T09:00:00",
  "expires_at": "2026-03-24T09:00:00"
}
```

### Thread Safety

TinyDB's JSON storage is not thread-safe. The platform wraps both tables in a `ThreadSafeTable` class that serializes all access through a `threading.Lock`, preventing concurrent read/write corruption when multiple endpoints (photo upload, video upload, WebSocket) access the database simultaneously.

---

## 9. Security & Anti-Cheating

### Authentication
- **Token-based**: Each interview invitation generates a unique UUID token
- **Token expiry**: Tokens expire after a configurable period (default: 7 days)
- **Single-use**: Token status transitions: `pending → active → completed`
- **URL validation**: Token checked on page load and WebSocket connection

### Anti-Cheating Measures

| Layer | Measure | Implementation |
|-------|---------|----------------|
| **AI Detection** | Copy-paste / ChatGPT detection | Claude Sonnet 4 with 9-point heuristic prompt |
| **Visual** | Tab switch detection | `visibilitychange` + `blur` events (silent, saved to DB) |
| **Visual** | Face tracking | face-api.js — no face, multiple faces, looking away |
| **Visual** | Eye tracking | Facial landmark-based gaze deviation detection |
| **Visual** | Object detection | COCO-SSD — phones, books, extra screens |
| **Audio** | Lip sync | Mouth aspect ratio vs audio activity correlation |
| **Visual** | Random photos | Random interval (15-45s) photo captures to S3 |
| **Visual** | Video recording | Full interview video with 30s backup uploads |
| **Visual** | Flagged snapshots | Auto-capture on proctoring violations with overlay |
| **Text** | Answer truncation | Long paste answers truncated to 3000 chars |

### AI-Generated Content Detection (9-Point Heuristic)

The analysis model checks for:
1. **Excessive Structure** — Numbered lists, headers, markdown formatting
2. **Textbook Completeness** — Suspiciously comprehensive coverage
3. **Generic Examples** — Hypothetical instead of resume-specific examples
4. **Formal Academic Tone** — Tutorial/documentation style language
5. **Comparison Tables** — Tabular formatting in answers
6. **Disproportionate Length** — Too long for live typing
7. **Consistency Check** — Quality/style jumps vs previous answers
8. **Perfect Grammar** — Flawless grammar throughout long answers
9. **Section Headers** — Categorized/sectioned responses

---

## 10. Cost Analysis

### AWS Service Pricing (US East 1, as of March 2026)

#### Amazon Bedrock — LLM Costs

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|----------------------|----------------------|
| Claude 3.5 Sonnet v2 | $3.00 | $15.00 |
| Claude Sonnet 4 | $3.00 | $15.00 |

#### Amazon Polly — TTS Costs

| Engine | Price (per 1M characters) |
|--------|--------------------------|
| Neural | $16.00 |

#### Amazon S3 — Storage Costs

| Resource | Price |
|----------|-------|
| Storage | $0.023 / GB / month |
| PUT requests | $0.005 / 1,000 requests |
| GET requests | $0.0004 / 1,000 requests |

### Cost Per Interview (10-Question Interview)

| Component | Tokens/Chars | Cost |
|-----------|-------------|------|
| **Greeting generation** (Sonnet v2) | ~2500 input + ~200 output | $0.0105 |
| **First question** (Sonnet v2) | ~2200 input + ~100 output | $0.0081 |
| **Answer analysis × 10** (Sonnet 4) | ~3000 input + ~500 output × 10 | $0.165 |
| **Polly TTS × 12** (greeting + 10 questions + completion) | ~3000 chars total | $0.048 |
| **S3 storage** (video ~50MB + photos ~2MB) | 52 MB | $0.0012 |
| **S3 PUT requests** (~30 uploads) | 30 requests | $0.00015 |
| **Total per interview** | | **~$0.23** |

### Cost for 10 Interviews

| Item | Cost |
|------|------|
| 10 interviews × $0.23 | **$2.33** |
| S3 storage/month | ~$0.012 |
| **Total for 10 interviews** | **~$2.35** |

### Cost for 30-Question Interview (Default)

| Component | Cost |
|-----------|------|
| Answer analysis × 30 (Sonnet 4) | $0.495 |
| Polly TTS × 32 | $0.128 |
| Other LLM calls | $0.02 |
| S3 (longer video ~150MB) | $0.004 |
| **Total per 30-Q interview** | **~$0.65** |
| **10 interviews × 30 questions** | **~$6.50** |

### Monthly Cost Estimate (100 interviews/month, 30 questions each)

| Item | Monthly Cost |
|------|-------------|
| Bedrock LLM | ~$55 |
| Polly TTS | ~$13 |
| S3 Storage | ~$0.35 |
| S3 Requests | ~$0.15 |
| **Total** | **~$68.50/month** |

---

## 11. Market Comparison

### Competing AI Interview Platforms

| Platform | Pricing | Key Features | Limitations |
|----------|---------|-------------|-------------|
| **HireVue** | $25,000-$75,000/year (enterprise) | Video interviews, AI scoring, game-based assessments | Expensive, opaque AI scoring, no LLM-based conversations |
| **Interviewing.io** | $150-$250/interview (mock) | Live technical interviews, human + AI | Expensive per-interview, focused on mock interviews |
| **Karat** | $300-$500/interview | Expert-led technical interviews | Very expensive, human interviewers required |
| **CoderPad** | $100-$500/month | Code collaboration, technical screening | No AI interviewer, just coding environment |
| **TestGorilla** | $75-$400/month | Pre-made assessments, skills tests | No conversational AI, fixed assessments |
| **Coderbyte** | $199-$599/month | Coding challenges, assessments | No real-time AI conversation |
| **HackerRank** | $100-$450/month | Coding tests, technical screens | No AI-powered interview conversation |
| **Metaview** | $5,000-$20,000/year | AI interview notes, analysis | Passive tool (doesn't conduct interviews) |

### Our Platform Advantages

| Advantage | Detail |
|-----------|--------|
| **Cost** | ~$0.23-$0.65/interview vs $150-$500 for competitors |
| **Full AI Interviewer** | Adaptive, conversational AI that conducts the full interview |
| **Real-time Proctoring** | Face tracking, object detection, lip sync — most competitors lack this |
| **AI-Detection** | Detects ChatGPT/copy-paste answers — unique capability |
| **Open/Self-hosted** | Run on your own AWS account, full data control |
| **Customizable** | Questions, scoring, difficulty adapts per candidate |
| **No per-seat licensing** | Pay only for AWS usage |

### Cost Comparison (100 interviews/month)

| Solution | Monthly Cost |
|----------|-------------|
| **This Platform** | **~$69** |
| HireVue | $2,000-$6,000 |
| Karat | $30,000-$50,000 |
| HackerRank | $100-$450 + human time |
| TestGorilla | $75-$400 + human time |

---

## 12. Setup & Deployment

### Prerequisites

- Python 3.9+
- AWS account with Bedrock, Polly, and S3 access
- AWS credentials (access key, secret key, session token)

### Installation

```bash
# Clone repository
cd interview_app

# Create virtual environment
python3 -m venv .venv

# Activate
source .venv/bin/activate       # macOS/Linux
# .venv\Scripts\activate        # Windows

# Install dependencies
pip install fastapi uvicorn python-dotenv boto3 faiss-cpu numpy pdfplumber tinydb python-multipart 'uvicorn[standard]'
```

### Environment Configuration (.env)

```env
# AWS Credentials
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_SESSION_TOKEN=your_token        # If using temporary credentials
AWS_DEFAULT_REGION=us-east-1

# Interview Settings
INTERVIEW_TOTAL_QUESTIONS=30        # Questions per interview

# Email (SMTP)
SENDER_EMAIL=noreply@company.com
BASE_URL=http://localhost:8000
SMTP_HOST=smtp.office365.com        # Leave empty for console mode
SMTP_PORT=587
SMTP_USER=your@email.com
SMTP_PASSWORD=your_password

# S3 Buckets
S3_BUCKET=interview-photos
S3_INTERVIEW_BUCKET=ai-interview-assistant-recordings

# LLM Model (optional override)
ANALYSIS_MODEL_ID=us.anthropic.claude-sonnet-4-20250514-v1:0
```

### Running

```bash
uvicorn interview_app:app --reload
```

Access at: http://localhost:8000

### API Documentation

Swagger UI: http://localhost:8000/docs

---

## 13. Future Improvements

### High Priority

| Improvement | Description | Estimated Effort |
|-------------|-------------|-----------------|
| **PostgreSQL migration** | Replace TinyDB with PostgreSQL for production scalability | Medium |
| **Code execution sandbox** | Let candidates write and run code during interview | High |
| **Streaming LLM responses** | Stream AI responses for faster perceived latency | Medium |
| **Resume video upload** | Accept video resumes alongside PDF | Low |
| **Multi-language support** | Support interviews in languages other than English | Medium |
| **Custom question bank** | Let recruiters define specific questions per role | Low |
| **Interview scheduling** | Calendar integration for scheduling interviews | Medium |

### Medium Priority

| Improvement | Description |
|-------------|-------------|
| **Admin dashboard** | Rich dashboard with charts, analytics, and candidate pipeline view |
| **Role-based access** | Separate recruiter, admin, and reviewer roles |
| **Batch processing** | Process multiple candidates simultaneously |
| **Export reports** | PDF/Excel export of interview reports |
| **Webhook integrations** | Integrate with ATS systems (Greenhouse, Lever, etc.) |
| **Custom scoring rubrics** | Configurable scoring criteria per role |
| **Interview replay** | Video playback with transcript and flag timeline |

### Low Priority / Nice-to-Have

| Improvement | Description |
|-------------|-------------|
| **Mobile support** | Responsive UI for mobile interviews |
| **Screen sharing detection** | Detect if candidate is sharing screen with someone |
| **Typing pattern analysis** | Detect paste events vs natural typing cadence |
| **Voice biometrics** | Verify candidate identity via voice signature |
| **Multi-round interviews** | Support multiple interview rounds with different focus areas |
| **AI interview customization** | Configurable interview personality (strict, casual, etc.) |
| **Real-time alerts** | Notify recruiters of suspicious activity during live interviews |
| **Candidate feedback** | Post-interview feedback form for candidates |

### Architecture Improvements

| Improvement | Description |
|-------------|-------------|
| **Containerization** | Docker + Docker Compose for consistent deployment |
| **CI/CD pipeline** | GitHub Actions for automated testing and deployment |
| **Load balancing** | Multiple Uvicorn workers behind nginx |
| **WebSocket scaling** | Redis pub/sub for multi-instance WebSocket support |
| **CDN for assets** | CloudFront for static assets and ML model files |
| **Monitoring** | CloudWatch metrics + alerts for errors and latency |
| **Rate limiting** | API rate limiting to prevent abuse |
| **HTTPS** | TLS termination for production deployment |
