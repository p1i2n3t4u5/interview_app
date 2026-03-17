import os
import json
import re
import random
import asyncio
import numpy as np
import faiss
import pdfplumber
import boto3
import uuid
import base64
from datetime import datetime, timedelta



from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect, Query as QueryParam
from fastapi.responses import FileResponse, HTMLResponse
from tinydb import TinyDB, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi import Form
from pydantic import BaseModel
from tinydb import TinyDB, Query
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart


# =========================
# Load environment
# =========================

load_dotenv()

AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_SESSION_TOKEN = os.getenv("AWS_SESSION_TOKEN")
AWS_REGION = os.getenv("AWS_DEFAULT_REGION", "us-east-1")

MODEL_ID = "us.anthropic.claude-3-5-sonnet-20241022-v2:0"
# Stronger reasoning model for answer analysis & AI-detection
ANALYSIS_MODEL_ID = os.getenv("ANALYSIS_MODEL_ID", "us.anthropic.claude-sonnet-4-20250514-v1:0")



bedrock = boto3.client(
    "bedrock-runtime",
    region_name=AWS_REGION,
    aws_access_key_id=AWS_ACCESS_KEY_ID,
    aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
    aws_session_token=AWS_SESSION_TOKEN
)

SENDER_EMAIL = os.getenv("SENDER_EMAIL", "gmohammed2@lululemon.com")
BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")

s3_client = boto3.client(
    "s3",
    region_name=AWS_REGION,
    aws_access_key_id=AWS_ACCESS_KEY_ID,
    aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
    aws_session_token=AWS_SESSION_TOKEN
)
S3_BUCKET = os.getenv("S3_BUCKET", "interview-photos")
S3_INTERVIEW_BUCKET = os.getenv("S3_INTERVIEW_BUCKET", "ai-interview-assistant-recordings")

polly = boto3.client(
    "polly",
    region_name=AWS_REGION,
    aws_access_key_id=AWS_ACCESS_KEY_ID,
    aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
    aws_session_token=AWS_SESSION_TOKEN
)

INTERVIEW_TOTAL_QUESTIONS = int(os.getenv("INTERVIEW_TOTAL_QUESTIONS", "30"))

app = FastAPI(title="AI Interview Agent Platform")


# =========================
# S3 Bucket Setup
# =========================

def ensure_s3_bucket():
    """Create S3 bucket if it doesn't exist."""
    for bucket_name in [S3_BUCKET, S3_INTERVIEW_BUCKET]:
        try:
            s3_client.head_bucket(Bucket=bucket_name)
            print(f"S3 bucket '{bucket_name}' exists.")
        except s3_client.exceptions.ClientError as e:
            error_code = int(e.response["Error"].get("Code", 0))
            if error_code == 404:
                # Bucket genuinely doesn't exist — create it
                try:
                    if AWS_REGION == "us-east-1":
                        s3_client.create_bucket(Bucket=bucket_name)
                    else:
                        s3_client.create_bucket(
                            Bucket=bucket_name,
                            CreateBucketConfiguration={"LocationConstraint": AWS_REGION}
                        )
                    print(f"Created S3 bucket: {bucket_name}")
                except Exception as ce:
                    print(f"Warning: Could not create S3 bucket '{bucket_name}': {ce}")
            elif error_code == 403:
                # Bucket exists but we lack permissions — that's fine, skip
                print(f"S3 bucket '{bucket_name}' exists (access restricted, skipping creation).")
            else:
                print(f"Warning: Could not check S3 bucket '{bucket_name}': {e}")
        except Exception as e:
            print(f"Warning: S3 bucket check failed for '{bucket_name}': {e}")


@app.on_event("startup")
async def startup_event():
    ensure_s3_bucket()


# =========================
# UI support
# =========================

app.mount("/ui", StaticFiles(directory="ui"), name="ui")
@app.get("/")
def home():
    return FileResponse("ui/index.html")

@app.get("/interview")
def interview_page():
    return FileResponse("ui/interview.html")

# =========================
# Database (thread-safe wrapper)
# =========================

import threading

_db_lock = threading.Lock()
_db = TinyDB("db.json")
_candidates_table = _db.table("candidates")
_interview_tokens_table = _db.table("interview_tokens")


class ThreadSafeTable:
    """Wrapper around TinyDB table that serializes all access with a lock."""
    def __init__(self, table, lock):
        self._table = table
        self._lock = lock

    def get(self, *args, **kwargs):
        with self._lock:
            return self._table.get(*args, **kwargs)

    def search(self, *args, **kwargs):
        with self._lock:
            return self._table.search(*args, **kwargs)

    def insert(self, *args, **kwargs):
        with self._lock:
            return self._table.insert(*args, **kwargs)

    def upsert(self, *args, **kwargs):
        with self._lock:
            return self._table.upsert(*args, **kwargs)

    def update(self, *args, **kwargs):
        with self._lock:
            return self._table.update(*args, **kwargs)

    def remove(self, *args, **kwargs):
        with self._lock:
            return self._table.remove(*args, **kwargs)

    def all(self):
        with self._lock:
            return self._table.all()

    def __len__(self):
        with self._lock:
            return len(self._table)


candidates_table = ThreadSafeTable(_candidates_table, _db_lock)
interview_tokens_table = ThreadSafeTable(_interview_tokens_table, _db_lock)


# =========================
# Config
# =========================

UPLOAD_DIR = "uploads"
MAX_QUESTIONS_PER_SKILL = 6
os.makedirs(UPLOAD_DIR, exist_ok=True)
KNOWLEDGE_DIR = "knowledge_files"
os.makedirs(KNOWLEDGE_DIR, exist_ok=True)


# =========================
# Question Bank
# =========================

if os.path.exists("questions.json"):
    with open("questions.json") as f:
        QUESTION_BANK = json.load(f)
else:
    QUESTION_BANK = {}


# =========================
# RAG Setup
# =========================

RAG_INDEX = "knowledge.index"
RAG_TEXT = "knowledge.npy"

knowledge_texts = []

if os.path.exists(RAG_INDEX):
    index = faiss.read_index(RAG_INDEX)
    knowledge_texts = np.load(RAG_TEXT, allow_pickle=True).tolist()
else:
    dim = 1024
    index = faiss.IndexFlatL2(dim)


# =========================
# Embeddings
# =========================

def embed(text):

    body = json.dumps({"inputText": text})

    response = bedrock.invoke_model(
        modelId="us.anthropic.claude-3-5-sonnet-20241022-v2:0",
        body=body,
        contentType="application/json",
        accept="application/json"
    )

    result = json.loads(response["body"].read())

    return np.array(result["embedding"], dtype="float32")


def search_knowledge(query):

    if not knowledge_texts:
        return ""

    vec = embed(query)

    _, ids = index.search(vec.reshape(1, -1), 3)

    return "\n".join([knowledge_texts[i] for i in ids[0]])


# =========================
# LLM
# =========================

def llm(prompt):

    body = json.dumps({

        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 1000,
        "temperature": 0.2,

        "messages": [
            {"role": "user", "content": prompt}
        ]
    })

    response = bedrock.invoke_model(
        modelId=MODEL_ID,
        body=body,
        contentType="application/json",
        accept="application/json"
    )

    result = json.loads(response["body"].read())

    return result["content"][0]["text"]


# =========================
# JSON Helpers
# =========================

def extract_json_object(text):

    try:
        json_text = re.search(r'\{.*\}', text, re.DOTALL).group()
        return json.loads(json_text)

    except:
        return {}


def extract_json_array(text):

    try:
        json_text = re.search(r'\[.*\]', text, re.DOTALL).group()
        return json.loads(json_text)

    except:
        return []


# =========================
# PDF Parser
# =========================

def extract_pdf_text(path):

    text = ""

    with pdfplumber.open(path) as pdf:

        for page in pdf.pages:

            page_text = page.extract_text()

            if page_text:
                text += page_text + "\n"

    return text


# =========================
# Candidate DB helpers
# =========================

def get_candidate(candidate_id):

    Candidate = Query()

    return candidates_table.get(Candidate.id == candidate_id)

def get_candidate_by_id(candidate_id):

    Candidate = Query()

    return candidates_table.get(Candidate.id == candidate_id)


def save_candidate(data):

    Candidate = Query()

    candidates_table.upsert(data, Candidate.id == data["id"])


# =========================
# Resume Parser
# =========================

def parse_resume(text):

    prompt = f"""
Extract structured resume information. Extract ALL available details.

Resume:
{text}

Return JSON:
{{
"name":"",
"email":"",
"phone":"",
"linkedin":"",
"github":"",
"location":"",
"summary":"",
"skills":[],
"technologies":[],
"years_experience": 0,
"education":[{{"degree":"","institution":"","year":""}}],
"work_experience":[{{"company":"","role":"","duration":"","description":""}}],
"certifications":[]
}}
"""

    return extract_json_object(llm(prompt))


# =========================
# JD Skill Extraction
# =========================

def extract_jd_skills(text):

    prompt = f"""
Extract technical skills from job description.

{text}

Return JSON array.
"""

    result = llm(prompt)

    return extract_json_array(result)

def generate_candidate_id(name):
    uid = str(uuid.uuid4())[:8]
    clean_name = re.sub(r'\s+', '_', name.lower())
    return f"{clean_name}_{uid}"


def process_resume(candidate_name, file_bytes):

    candidate_id = generate_candidate_id(candidate_name)

    path = os.path.join(
        UPLOAD_DIR,
        f"{candidate_id}_resume.pdf"
    )

    with open(path, "wb") as f:
        f.write(file_bytes)

    text = extract_pdf_text(path)
    parsed = parse_resume(text)
    skills = parsed.get("skills", [])
    tech = parsed.get("technologies", [])

    # data = {
    #     "id": candidate_id,
    #     "name": candidate_name,
    #     "resume": text,
    #     "candidate_skills": list(set(skills + tech)),
    #     "transcript": []
    # }

    data ={
        "id": candidate_id,
        "name": parsed.get("name", ""),
        "resume": text,
        "candidate_skills": list(set(skills + tech)),
        "email": parsed.get("email", ""),
        "phone": parsed.get("phone", ""),
        "linkedin": parsed.get("linkedin", ""),
        "github": parsed.get("github", ""),
        "location": parsed.get("location", ""),
        "summary": parsed.get("summary", ""),
        "education": parsed.get("education", []),
        "work_experience": parsed.get("work_experience", []),
        "certifications": parsed.get("certifications", []),
        "years_experience": parsed.get("years_experience", 0),
        "transcript": []
    }

    save_candidate(data)

    return {
        "candidate_id": candidate_id,
        "parsed_resume": parsed
    }


def normalize_transcript_llm(raw_transcript):

    prompt = f"""
You are an AI system that converts interview transcripts into a structured JSON format.

Input transcript:
{raw_transcript}

Convert it into a JSON ARRAY using the following schema:

[
 {{
   "skill": "",
   "question": "",
   "answer": "",
   "evaluation": {{
      "score": 0,
      "strengths": [],
      "weaknesses": [],
      "feedback": ""
   }}
 }}
]

Rules:
- Always return a valid JSON array
- Do not include explanations
- If skill is unknown use "general"
- Extract multiple Q/A pairs if present
"""

    response = llm(prompt)

    return extract_json_array(response)

# =========================
# Upload Resume
# =========================

@app.post("/upload_resume/{candidate}")
async def upload_resume(candidate: str, file: UploadFile = File(...)):

    file_bytes = await file.read()

    result = process_resume(candidate, file_bytes)

    return result

@app.post("/upload_resumes")
async def upload_resumes(files: list[UploadFile] = File(...)):

    results = []

    for file in files:

        candidate_name = os.path.splitext(file.filename)[0]

        file_bytes = await file.read()

        result = process_resume(candidate_name, file_bytes)

        results.append(result)

    return {
        "total_uploaded": len(results),
        "candidates": results
    }



# =========================
# Upload JD
# =========================

@app.post("/upload_jd/{candidate}")

async def upload_jd(candidate: str, file: UploadFile = File(...)):

    path = os.path.join(UPLOAD_DIR, f"{candidate}_jd.pdf")

    with open(path, "wb") as f:
        f.write(await file.read())

    jd_text = extract_pdf_text(path)

    skills = extract_jd_skills(jd_text)

    data = get_candidate(candidate)
    if not data:
        return {"error": "Candidate not found"}

    data.update({
        "jd": jd_text,
        "jd_skills": skills
    })

    save_candidate(data)

    return {"skills": skills}


# =========================
# Resume-JD Gap Analysis
# =========================

@app.get("/gap_analysis/{candidate}")

def gap(candidate):

    data = get_candidate(candidate)
    if not data:
        return {"error": "Candidate not found"}
    cskills = set(data.get("candidate_skills", []))
    jskills = set(data.get("jd_skills", []))

    return {

        "matched_skills": list(cskills & jskills),
        "missing_skills": list(jskills - cskills),
        "match_percent": round(len(cskills & jskills) / len(jskills) * 100, 2)
    }


# =========================
# Interview Initialization
# =========================

def init_interview(candidate):

    data = get_candidate(candidate)
    if not data:
        return {"error": "Candidate not found"}
    data["interview_state"] = {

        "skill_index": 0,
        "difficulty": "beginner",
        "skill_question_count": {}
    }

    for s in data.get("jd_skills", []):

        data["interview_state"]["skill_question_count"][s] = 0

    data["transcript"] = []

    save_candidate(data)


# =========================
# Question Bank
# =========================

def get_question_from_bank(skill, difficulty):

    if skill not in QUESTION_BANK:
        return None

    questions = QUESTION_BANK[skill].get(difficulty, [])

    if not questions:
        return None

    return random.choice(questions)


# =========================
# Difficulty Update
# =========================

def update_difficulty(state):

    total = sum(state["skill_question_count"].values())

    if total > 10:
        state["difficulty"] = "advanced"

    elif total > 5:
        state["difficulty"] = "intermediate"

    return state


# =========================
# Answer Evaluation
# =========================

def evaluate_answer(skill, question, answer):

    prompt = f"""
Evaluate candidate answer.

Skill: {skill}

Question:
{question}

Answer:
{answer}

Return JSON:

{{
"score": number,
"strengths": [],
"weaknesses": [],
"feedback": ""
}}
"""

    return extract_json_object(llm(prompt))


# =========================
# Generate Question
# =========================

def generate_question(candidate):

    data = get_candidate(candidate)
    if not data:
        return {"error": "Candidate not found"}
    state = data["interview_state"]

    skills = data.get("jd_skills", [])

    if state["skill_index"] >= len(skills):
        return None, None

    skill = skills[state["skill_index"]]

    if state["skill_question_count"][skill] >= MAX_QUESTIONS_PER_SKILL:

        state["skill_index"] += 1

        save_candidate(data)

        return generate_question(candidate)

    difficulty = state["difficulty"]

    question = get_question_from_bank(skill, difficulty)

    if not question:

        knowledge = search_knowledge(skill)

        prompt = f"""
Generate {difficulty} level question for skill {skill}.

Knowledge:
{knowledge}
"""

        question = llm(prompt)

    state["skill_question_count"][skill] += 1

    update_difficulty(state)

    save_candidate(data)

    return skill, question


# =========================
# WebSocket Interview
# =========================

@app.websocket("/ws/interview/{candidate}")

async def interview(ws: WebSocket, candidate: str):

    await ws.accept()

    data = get_candidate(candidate)

    if not data:
        await ws.send_json({"error": "candidate not found"})
        return

    init_interview(candidate)

    try:

        while True:
            skill, question = generate_question(candidate)
            if not question:
                await ws.send_json({"message": "Interview Completed"})
                await ws.close()
                break
            await ws.send_json({"skill": skill, "question": question})
            answer = await ws.receive_text()
            evaluation = evaluate_answer(skill, question, answer)
            data = get_candidate(candidate)
            data["transcript"].append({

                "skill": skill,
                "question": question,
                "answer": answer,
                "evaluation": evaluation
            })

            save_candidate(data)

    except WebSocketDisconnect:

        print("Disconnected")


# =========================
# Skill Confidence Score
# =========================

def compute_skill_scores(transcript):

    skill_scores = {}

    for item in transcript:

        skill = item["skill"]

        score = item["evaluation"].get("score", 0)

        skill_scores.setdefault(skill, []).append(score)

    return {k: round(sum(v)/len(v), 2) for k,v in skill_scores.items()}


# =========================
# Interview Report
# =========================

@app.get("/interview_report/{candidate}")
def report(candidate):

    data = get_candidate(candidate)

    if not data:
        return {"error": "Candidate not found"}

    transcript = data.get("transcript", [])

    if not transcript:
        return {"error": "No transcript available"}

    skill_scores = compute_skill_scores(transcript)

    prompt = f"""
Generate final hiring recommendation.

Skill scores:
{skill_scores}

Return JSON:
{{
"overall_score": number,
"strengths":[],
"weaknesses":[],
"recommendation":"Hire | No Hire | Borderline"
}}
"""

    report = extract_json_object(llm(prompt))

    return {
        "candidate": candidate,
        "transcript": transcript,
        "skill_scores": skill_scores,
        "report": report
    }

# =========================
# Transcript API
# =========================

@app.get("/transcript/{candidate}")

def transcript(candidate):

    data = get_candidate(candidate)

    return data.get("transcript", [])



#
# @app.post("/submit_transcript/{candidate}")
# def submit_transcript(candidate: str, transcript: list = Body(...)):
#     candidate_data = get_candidate(candidate)
#     if not candidate_data:
#         return {"error": "candidate not found"}
#
#     # Merge with existing transcript if any
#     existing = candidate_data.get("transcript", [])
#     candidate_data["transcript"] = existing + transcript
#
#     save_candidate(candidate_data)
#     return {"status": "saved", "candidate": candidate, "total_questions": len(candidate_data["transcript"])}


# =========================
# Analytics Dashboard
# =========================

@app.get("/analytics")

def analytics():

    all_data = candidates_table.all()

    total = len(all_data)

    scores = []

    for c in all_data:

        for t in c.get("transcript", []):

            if "evaluation" in t:

                scores.append(t["evaluation"].get("score", 0))

    avg_score = round(sum(scores)/len(scores),2) if scores else 0

    return {

        "total_candidates": total,
        "average_answer_score": avg_score
    }

# =========================
# Improve the Knowledgebase
# =========================

@app.post("/upload_knowledge")
async def upload_knowledge(file: UploadFile = File(...)):

    # save original file
    file_path = os.path.join(KNOWLEDGE_DIR, file.filename)

    with open(file_path, "wb") as f:
        f.write(await file.read())

    # read text
    if file.filename.endswith(".pdf"):
        text = extract_pdf_text(file_path)
    else:
        with open(file_path, "r", encoding="utf-8") as f:
            text = f.read()

    # chunk text
    chunks = [c.strip() for c in text.split("\n\n") if c.strip()]

    added = 0

    for chunk in chunks:
        vec = embed(chunk)

        index.add(vec.reshape(1, -1))
        knowledge_texts.append(chunk)

        added += 1

    # persist index
    faiss.write_index(index, RAG_INDEX)
    np.save(RAG_TEXT, np.array(knowledge_texts, dtype=object))

    return {
        "file_saved": file_path,
        "chunks_added": added
    }

# =========================
# List the Knowledgebase files
# =========================
@app.get("/knowledge_files")
def list_knowledge():

    return {
        "files": os.listdir(KNOWLEDGE_DIR)
    }




@app.post("/rank_candidates")
async def rank_candidates(
        jd_file: UploadFile = File(...),
        candidate_ids: str = Form(...),
        top_n: int = Form(5)
):

    candidate_ids = json.loads(candidate_ids)
    path = os.path.join(UPLOAD_DIR, "temp_jd.pdf")
    with open(path, "wb") as f:
        f.write(await jd_file.read())
    jd_text = extract_pdf_text(path)
    jd_skills = extract_jd_skills(jd_text)
    Candidate = Query()
    results = []
    for cid in candidate_ids:
        c = candidates_table.get(Candidate.id == cid)
        if not c:
            continue
        skills = c.get("candidate_skills", [])
        score = compute_match_score(skills, jd_skills)
        results.append({
            "candidate_id": cid,
            "candidate": c["name"],
            "skills": skills,
            "match_score": score
        })

    results.sort(key=lambda x: x["match_score"], reverse=True)

    return {
        "jd_skills": jd_skills,
        "top_candidates": results[:top_n]
    }
# =========================
# get Candidates
# =========================
@app.get("/candidates")
def list_candidates():
    candidates = candidates_table.all()
    result = []
    for c in candidates:
        result.append({
            "candidate_id": c.get("id"),
            "name": c.get("name"),
            "skills": c.get("candidate_skills", [])
        })
    return {
        "total_candidates": len(result),
        "candidates": result
    }



def compute_match_score(candidate_skills, jd_skills):
    cskills = set([s.lower() for s in candidate_skills])
    jskills = set([s.lower() for s in jd_skills])
    matched = cskills & jskills
    if not jskills:
        return 0

    score = len(matched) / len(jskills)
    return round(score * 100, 2)


# =========================
# Transcript API
# =========================

@app.get("/transcript/{candidate}")

def transcript(candidate):
    data = get_candidate(candidate)
    return data.get("transcript", [])



from fastapi import Body

@app.post("/submit_transcript/{candidate}")
def submit_transcript(candidate: str, body: dict = Body(...)):
    candidate_data = get_candidate(candidate)
    if not candidate_data:
        return {"error": "candidate not found"}
    raw_transcript = body.get("transcript", "")
    if not raw_transcript:
        return {"error": "Transcript empty"}
    # LLM formatting
    normalized = normalize_transcript_llm(raw_transcript)
    existing = candidate_data.get("transcript", [])
    candidate_data["transcript"] = existing + normalized
    save_candidate(candidate_data)
    return {
        "status": "saved",
        "questions_added": len(normalized),
        "total_questions": len(candidate_data["transcript"])
    }

# =====================
# candidate comparison
# =====================
@app.get("/candidate_comparison")
def candidate_comparison():
    all_candidates = candidates_table.all()
    results = []
    for c in all_candidates:
        transcript = c.get("transcript", [])
        skill_scores = compute_skill_scores(transcript)
        if not skill_scores:
            continue
        overall_score = round(
            sum(skill_scores.values()) / len(skill_scores), 2
        )
        results.append({
            "name": c.get("name"),
            "candidate_id": c.get("id"),
            "score": overall_score
        })
    return {
        "candidates": results
    }

# =========================
# Interview Token Infrastructure
# =========================

TOKEN_EXPIRY_HOURS = 24


def generate_interview_token(candidate_id, candidate_email, candidate_name):
    token = str(uuid.uuid4())
    now = datetime.utcnow()
    token_record = {
        "token": token,
        "candidate_id": candidate_id,
        "candidate_name": candidate_name,
        "candidate_email": candidate_email,
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(hours=TOKEN_EXPIRY_HOURS)).isoformat(),
        "used": False,
        "status": "pending"
    }
    interview_tokens_table.insert(token_record)
    return token


def validate_token(token):
    Token = Query()
    record = interview_tokens_table.get(Token.token == token)
    if not record:
        return None, "Invalid token"
    if record.get("status") == "completed":
        return None, "Interview already completed"
    expires_at = datetime.fromisoformat(record["expires_at"])
    if datetime.utcnow() > expires_at:
        return None, "Token has expired"
    return record, None


# =========================
# Send Interview Email
# =========================

class EmailRequest(BaseModel):
    name: str
    email: str
    id: str


def send_interview_email(to_email, candidate_name, interview_url):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Your Interview Invitation"
    msg["From"] = SENDER_EMAIL
    msg["To"] = to_email

    html_body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2c3e50;">Hello {candidate_name},</h2>
        <p>You have been invited to an AI-powered interview session.</p>
        <p>Please click the button below to begin your interview. Make sure you have a working camera and microphone before starting.</p>
        <div style="text-align: center; margin: 30px 0;">
            <a href="{interview_url}"
               style="background-color: #3498db; color: white; padding: 14px 28px; text-decoration: none; border-radius: 5px; font-size: 16px;">
                Start Interview
            </a>
        </div>
        <p style="color: #7f8c8d; font-size: 13px;">This link is valid for {TOKEN_EXPIRY_HOURS} hours and can only be used once.</p>
        <p>Best regards,<br>AI Interview Platform</p>
    </body>
    </html>
    """
    msg.attach(MIMEText(html_body, "html"))

    if SMTP_HOST:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            if SMTP_USER:
                server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SENDER_EMAIL, to_email, msg.as_string())
    else:
        print(f"[EMAIL] No SMTP configured. Interview email for {candidate_name} <{to_email}>:")
        print(f"  Interview Link: {interview_url}")


@app.post("/send_email")
def send_email(payload: EmailRequest):
    candidate = get_candidate_by_id(payload.id)
    if not candidate:
        return {"error": "Candidate not found"}

    token = generate_interview_token(payload.id, payload.email, payload.name)
    interview_url = f"{BASE_URL}/interview?token={token}"

    # Always store the configured question count from env/config
    Token = Query()
    interview_tokens_table.update(
        {"total_questions": INTERVIEW_TOTAL_QUESTIONS},
        Token.token == token
    )

    email_status = "sent"
    email_error = None
    try:
        send_interview_email(payload.email, payload.name, interview_url)
    except Exception as e:
        email_status = "email_failed"
        email_error = str(e)

    return {
        "status": email_status,
        "token": token,
        "interview_url": interview_url,
        "total_questions": INTERVIEW_TOTAL_QUESTIONS,
        **({"email_error": email_error} if email_error else {})
    }


# =========================
# Validate Token
# =========================

@app.get("/validate_token")
def validate_token_endpoint(token: str = QueryParam(...)):
    record, error = validate_token(token)
    if error:
        return {"valid": False, "error": error}

    candidate = get_candidate_by_id(record["candidate_id"])
    return {
        "valid": True,
        "candidate_id": record["candidate_id"],
        "candidate_name": record["candidate_name"],
        "candidate_email": record["candidate_email"],
        "resume_summary": candidate.get("summary", "") if candidate else "",
        "jd_skills": candidate.get("jd_skills", []) if candidate else [],
        "total_questions": record.get("total_questions", INTERVIEW_TOTAL_QUESTIONS)
    }


# =========================
# AI Interview - Speech & LLM
# =========================

def synthesize_speech(text):
    response = polly.synthesize_speech(
        Text=text,
        OutputFormat="mp3",
        VoiceId="Matthew",
        Engine="neural"
    )
    audio_bytes = response['AudioStream'].read()
    return base64.b64encode(audio_bytes).decode('utf-8')


def generate_greeting(candidate_name, resume_text, jd_text, total_questions):
    prompt = f"""You are a warm, encouraging, and professional AI interviewer conducting a technical interview.

Candidate Name: {candidate_name}

Candidate's Resume Summary:
{resume_text[:2000]}

Job Description:
{jd_text[:2000]}

Generate a warm, professional greeting for the candidate. Include:
1. Welcome them by their name
2. Briefly mention the role they're interviewing for (from JD)
3. Set expectations (mention this will be a comprehensive interview with around {total_questions} questions)
4. Ask them to briefly introduce themselves

Keep it concise and friendly (3-4 sentences max). Speak naturally as if talking to them.

IMPORTANT TONE RULES:
- Always be warm, encouraging, and supportive
- Never be judgmental or harsh
- Make the candidate feel comfortable and at ease"""
    return llm(prompt)


def process_answer_and_generate_next(candidate_name, resume_text, jd_text, transcript, current_question, current_answer, skill_area, question_number, total_questions):
    transcript_text = ""
    for item in transcript[-10:]:
        transcript_text += f"\nQ{item.get('question_number', '?')} ({item.get('skill_area', 'general')}): {item['question']}\nA: {item['answer']}\nScore: {item.get('analysis', {}).get('score', 'N/A')}/10\n"

    prompt = f"""You are a warm, encouraging, and professional AI interviewer conducting a technical interview.

Candidate: {candidate_name}
Resume: {resume_text[:2000]}
Job Description: {jd_text[:2000]}

Recent transcript:
{transcript_text}

Current Question (#{question_number}): {current_question}
Skill Area: {skill_area}
Candidate's Answer: {current_answer}

TASK 1 - Analyze the answer (internal analysis, NOT shared with candidate):
- Is it technically correct?
- Does it show genuine deep understanding or appears memorized/surface-level?
- Does the depth match their resume experience?
- Any signs of fabrication (vague generalities, buzzword stuffing, contradictions)?

AI-GENERATED / COPY-PASTE DETECTION (CRITICAL - analyze carefully):
You MUST carefully evaluate whether this answer was likely typed genuinely by the candidate OR copy-pasted from ChatGPT, Google, or similar AI tools. Set ai_generated=true if you detect ANY of these patterns:

1. **Excessive Structure**: Uses numbered lists, bullet points, headers, or markdown-like formatting that no one would type in a live interview text box. Real candidates speak/type in natural paragraphs.
2. **Textbook Completeness**: Covers every conceivable aspect of the topic with suspiciously comprehensive breadth. Real candidates focus on what they know, not encyclopedic coverage.
3. **Generic Examples**: Uses generic hypothetical examples ("In one of the systems I worked on...") instead of naming specific projects, technologies, or team details from THEIR resume.
4. **Formal Academic Tone**: Reads like a tutorial, blog post, or documentation rather than conversational speech. Look for phrases like "Key characteristics include", "It is important to note", "Aspects include".
5. **Comparison Tables**: Any tabular or structured comparison format ("Aspect | X | Y") is almost certainly copy-pasted.
6. **Disproportionate Length**: Answer is dramatically longer than what someone could reasonably type in 30-60 seconds of a live interview.
7. **Consistency Check**: Compare against previous answers. If quality/style suddenly jumps, it's likely copy-pasted.
8. **Perfect Grammar**: Flawless grammar, punctuation, and sentence structure throughout a long answer is unnatural for live typing.
9. **Section Headers**: Any answer that uses section headers or numbered categories is copy-pasted.

Be AGGRESSIVE in flagging. In a real interview, candidates give concise 3-8 sentence answers, not multi-paragraph structured essays. When in doubt, flag it.
Provide specific reasoning in ai_generated_reason citing which patterns you detected.

TASK 2 - Determine the response type:
- If the candidate asks you to REPEAT the question (e.g. "could you please repeat", "say that again", "I didn't catch that", "can you repeat"), set response_type to "repeat" and put the SAME question back in next_question.question (rephrased slightly for clarity).
- If the candidate says they CANNOT HEAR you (e.g. "I can't hear you", "no audio", "your voice is not working"), set response_type to "clarification" and respond helpfully — mention there is a text input area where they can read and type responses.
- If the candidate gives a very short non-answer (e.g. just "hello", "hi", "okay", "yes", "no" without elaboration), set response_type to "encouragement" and gently encourage them to elaborate on the current question.
- Otherwise, set response_type to "normal" and generate the next question as described below.

TASK 3 - Generate the next question (only for response_type "normal"):
- ALWAYS start the question with a brief, natural transition from the candidate's previous answer. Examples: "Great insight about caching strategies!", "That's interesting how you approached the microservices migration.", "Thanks for sharing your experience with Kafka."
- Then ask the new question.
- If the answer appears shallow, ask a DEEPER follow-up on the SAME topic
- Otherwise, move to a new skill area from the resume/JD
- Progress difficulty as the interview progresses
- Cover diverse skills across the interview
- Question {question_number} of {total_questions} total

CRITICAL RULES:
1. NEVER repeat a question you already asked (unless response_type is "repeat"). Each new question MUST be unique.
2. ALWAYS generate a proper TECHNICAL question for response_type "normal". Never generate interview management messages.
3. Even if candidate answers poorly, stay professional and keep asking new technical questions.
4. NEVER tell the candidate the interview is terminated or that they failed.
5. Be encouraging - if a candidate struggles, simplify the question or move to a different topic.
6. NEVER include phrases like "interview terminated", "qualification misrepresentation", "blacklisting", "fraud", or similar harsh language.
7. Score fairly but keep moving forward with new questions regardless of scores.
8. For "repeat" type: Include a kind preamble like "Of course! Let me rephrase that for you." before the question.
9. For "clarification" type: Be helpful and warm, e.g. "I understand! You can read my questions in the chat area above, and use the text input box below to type your answers."
10. For "encouragement" type: Be gentle, e.g. "I'd love to hear more about that! Could you elaborate on..." and re-ask the current question.

Return ONLY this JSON:
{{
  "analysis": {{
    "score": 0,
    "is_correct": true,
    "appears_authentic": true,
    "ai_generated": false,
    "ai_generated_reason": "",
    "depth": "shallow",
    "strengths": [],
    "weaknesses": [],
    "feedback": "",
    "follow_up_needed": false,
    "follow_up_reason": ""
  }},
  "response_type": "normal",
  "next_question": {{
    "question": "",
    "skill_area": "",
    "difficulty": "beginner",
    "is_follow_up": false
  }}
}}"""

    body = json.dumps({
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 2000,
        "temperature": 0.3,
        "messages": [{"role": "user", "content": prompt}]
    })

    # Try analysis model first, fall back to general model if unavailable
    for model_id in [ANALYSIS_MODEL_ID, MODEL_ID]:
        try:
            response = bedrock.invoke_model(
                modelId=model_id,
                body=body,
                contentType="application/json",
                accept="application/json"
            )
            result = json.loads(response["body"].read())
            return extract_json_object(result["content"][0]["text"])
        except Exception as e:
            print(f"[Analysis] Model {model_id} failed: {e}")
            if model_id == MODEL_ID:
                raise  # Both models failed, propagate
            continue  # Try fallback


def generate_first_question(candidate_name, resume_text, jd_text):
    prompt = f"""You are a professional AI interviewer.

Candidate: {candidate_name}
Resume: {resume_text[:2000]}
Job Description: {jd_text[:2000]}

Generate the first technical interview question. Start with something approachable based on the candidate's primary skills from their resume that also aligns with the JD requirements.

Return ONLY this JSON:
{{
  "question": "",
  "skill_area": "",
  "difficulty": "beginner"
}}"""
    return extract_json_object(llm(prompt))


# =========================
# AI Interview WebSocket
# =========================

@app.websocket("/ws/ai_interview/{token}")
async def ai_interview_ws(ws: WebSocket, token: str):
    await ws.accept()

    # Send immediate ack so client leaves "Connecting..." state instantly
    await ws.send_json({"type": "connected", "message": "Preparing your interview..."})

    Token = Query()
    record = interview_tokens_table.get(Token.token == token)
    if not record or record.get("status") == "completed":
        await ws.send_json({"type": "error", "message": "Invalid or expired session"})
        await ws.close()
        return

    expires_at = datetime.fromisoformat(record["expires_at"])
    if datetime.utcnow() > expires_at:
        await ws.send_json({"type": "error", "message": "Session has expired"})
        await ws.close()
        return

    # Mark token as active
    interview_tokens_table.update({"status": "active"}, Token.token == token)

    candidate = get_candidate_by_id(record["candidate_id"])
    if not candidate:
        await ws.send_json({"type": "error", "message": "Candidate not found"})
        await ws.close()
        return

    candidate_name = candidate["name"]
    resume_text = candidate.get("resume", "")
    jd_text = candidate.get("jd", "")
    ai_transcript = []

    # Get configurable question count (from token record or env default)
    total_questions = record.get("total_questions", INTERVIEW_TOTAL_QUESTIONS)

    # Initialize proctoring data in candidate DB
    candidate_data = get_candidate_by_id(record["candidate_id"])
    if candidate_data:
        proctoring = candidate_data.get("proctoring", {"flags": [], "video_s3_key": ""})
        proctoring["interview_started_at"] = datetime.utcnow().isoformat()
        candidate_data["proctoring"] = proctoring
        save_candidate(candidate_data)

    try:
        # Step 1: Generate greeting + first question in parallel (both are independent LLM calls)
        greeting_text, first_q = await asyncio.gather(
            asyncio.to_thread(generate_greeting, candidate_name, resume_text, jd_text, total_questions),
            asyncio.to_thread(generate_first_question, candidate_name, resume_text, jd_text)
        )

        try:
            greeting_audio = await asyncio.to_thread(synthesize_speech, greeting_text)
        except Exception:
            greeting_audio = ""

        await ws.send_json({
            "type": "greeting",
            "text": greeting_text,
            "audio": greeting_audio,
            "question_number": 0,
            "total_questions": total_questions
        })

        # Receive introduction
        intro_data = await ws.receive_json()
        intro_text = intro_data.get("text", "")

        ai_transcript.append({
            "question_number": 0,
            "type": "introduction",
            "question": greeting_text,
            "answer": intro_text,
            "skill_area": "introduction",
            "timestamp": datetime.utcnow().isoformat()
        })

        # Save introduction
        candidate_data = get_candidate_by_id(record["candidate_id"])
        candidate_data["ai_interview_transcript"] = ai_transcript
        save_candidate(candidate_data)

        # First question already generated in parallel above
        current_question = first_q.get("question", "Tell me about your experience.")
        current_skill = first_q.get("skill_area", "general")
        current_difficulty = first_q.get("difficulty", "beginner")

        question_number = 1

        while question_number <= total_questions:
            # Send question
            try:
                question_audio = await asyncio.to_thread(synthesize_speech, current_question)
            except Exception:
                question_audio = ""

            await ws.send_json({
                "type": "question",
                "text": current_question,
                "audio": question_audio,
                "skill_area": current_skill,
                "difficulty": current_difficulty,
                "question_number": question_number,
                "total_questions": total_questions
            })

            # Receive answer
            answer_data = await ws.receive_json()
            answer_text = answer_data.get("text", "")

            # Truncate excessively long answers to prevent LLM timeouts
            if len(answer_text) > 3000:
                answer_text = answer_text[:3000] + "... [truncated]"

            # Analyze answer + generate next question (run in thread to not block event loop)
            try:
                result = await asyncio.to_thread(
                    process_answer_and_generate_next,
                    candidate_name, resume_text, jd_text,
                    ai_transcript, current_question, answer_text,
                    current_skill, question_number, total_questions
                )
            except Exception as e:
                print(f"[WebSocket] Analysis failed for Q{question_number}: {e}")
                # Provide a safe fallback so the interview continues
                result = {
                    "analysis": {
                        "score": 5, "is_correct": True, "appears_authentic": True,
                        "ai_generated": False, "ai_generated_reason": "",
                        "depth": "moderate", "strengths": [], "weaknesses": [],
                        "feedback": "Analysis unavailable", "follow_up_needed": False, "follow_up_reason": ""
                    },
                    "response_type": "normal",
                    "next_question": {
                        "question": f"Tell me more about your experience with {current_skill}.",
                        "skill_area": current_skill,
                        "difficulty": "intermediate",
                        "is_follow_up": False
                    }
                }

            analysis = result.get("analysis", {})
            next_q = result.get("next_question", {})
            response_type = result.get("response_type", "normal")

            # If score > 5, strip weaknesses (good answer, no need to track weaknesses)
            score = analysis.get("score", 0)
            if score > 5:
                analysis["weaknesses"] = []

            # Build red flags for this question
            red_flag_entry = None
            flags = []

            if analysis.get("ai_generated"):
                flags.append({
                    "flag": "ai_generated_answer",
                    "reason": analysis.get("ai_generated_reason", "Answer appears AI-generated")
                })

            if score <= 3:
                flags.append({
                    "flag": "very_low_score",
                    "reason": f"Score {score}/10 on {current_skill}"
                })

            if not analysis.get("appears_authentic"):
                flags.append({
                    "flag": "authenticity_concern",
                    "reason": analysis.get("feedback", "Answer does not appear authentic")
                })

            if analysis.get("depth") in ("none", "very shallow"):
                flags.append({
                    "flag": "no_depth",
                    "reason": f"Answer depth: {analysis.get('depth', 'unknown')} on {current_skill}"
                })

            if flags:
                red_flag_entry = {
                    "question_number": question_number,
                    "skill_area": current_skill,
                    "flags": flags,
                    "timestamp": datetime.utcnow().isoformat()
                }

            # Save to transcript
            entry = {
                "question_number": question_number,
                "type": response_type if response_type != "normal" else ("follow_up" if next_q.get("is_follow_up") else "question"),
                "question": current_question,
                "answer": answer_text,
                "skill_area": current_skill,
                "difficulty": current_difficulty,
                "analysis": analysis,
                "timestamp": datetime.utcnow().isoformat()
            }
            ai_transcript.append(entry)

            # Save progress + red flags to DB
            candidate_data = get_candidate_by_id(record["candidate_id"])
            candidate_data["ai_interview_transcript"] = ai_transcript
            if red_flag_entry:
                red_flags = candidate_data.get("red_flags", [])
                red_flags.append(red_flag_entry)
                candidate_data["red_flags"] = red_flags
            save_candidate(candidate_data)

            # Prepare next question
            current_question = next_q.get("question", "Tell me more about your experience.")
            current_skill = next_q.get("skill_area", current_skill)
            current_difficulty = next_q.get("difficulty", "intermediate")

            # Only advance question counter for normal responses
            if response_type == "normal":
                question_number += 1

        # Interview complete
        scores = [e["analysis"].get("score", 0) for e in ai_transcript if "analysis" in e]
        avg_score = round(sum(scores) / len(scores), 2) if scores else 0

        completion_text = f"Thank you {candidate_name} for completing the interview. We appreciate your time and will get back to you soon."
        try:
            completion_audio = await asyncio.to_thread(synthesize_speech, completion_text)
        except Exception:
            completion_audio = ""

        await ws.send_json({
            "type": "complete",
            "text": completion_text,
            "audio": completion_audio,
            "total_questions_asked": len(ai_transcript) - 1,
            "average_score": avg_score
        })

        interview_tokens_table.update({"status": "completed"}, Token.token == token)
        candidate_data = get_candidate_by_id(record["candidate_id"])
        candidate_data["interview_status"] = "completed"
        candidate_data["interview_average_score"] = avg_score
        save_candidate(candidate_data)

        await ws.close()

    except WebSocketDisconnect:
        candidate_data = get_candidate_by_id(record["candidate_id"])
        candidate_data["ai_interview_transcript"] = ai_transcript
        candidate_data["interview_status"] = "disconnected"
        save_candidate(candidate_data)


# =========================
# Photo Capture to S3
# =========================

class PhotoUpload(BaseModel):
    token: str
    photo: str
    flag: str = ""

@app.post("/upload_photo")
def upload_photo(payload: PhotoUpload):
    record, error = validate_token(payload.token)
    if error:
        return {"error": error}

    # Strip data URI prefix if present
    photo_data = payload.photo
    if "," in photo_data:
        photo_data = photo_data.split(",", 1)[1]

    photo_bytes = base64.b64decode(photo_data)

    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S_%f")
    flag_suffix = f"_{payload.flag}" if payload.flag else ""
    key = f"interviews/{record['candidate_id']}/{record['token']}/{timestamp}{flag_suffix}.jpg"

    try:
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=key,
            Body=photo_bytes,
            ContentType="image/jpeg"
        )

        # Generate a presigned URL valid for 7 days
        photo_url = s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": S3_BUCKET, "Key": key},
            ExpiresIn=7 * 24 * 3600
        )

        # Save photo link in candidate DB
        candidate_data = get_candidate_by_id(record["candidate_id"])
        if candidate_data:
            photos = candidate_data.get("interview_photos", [])
            photos.append({
                "s3_key": key,
                "url": photo_url,
                "flag": payload.flag,
                "timestamp": timestamp,
                "token": record["token"]
            })
            candidate_data["interview_photos"] = photos
            save_candidate(candidate_data)

        return {"status": "uploaded", "key": key, "url": photo_url}
    except Exception as e:
        return {"status": "upload_failed", "error": str(e)}


# =========================
# Proctoring - S3 Upload Endpoints
# =========================

@app.post("/api/upload_video_chunk")
async def upload_video_chunk(
    token: str = Form(...),
    chunk_index: int = Form(0),
    file: UploadFile = File(...)
):
    Token = Query()
    record = interview_tokens_table.get(Token.token == token)
    if not record:
        return {"error": "Invalid token"}

    candidate_id = record["candidate_id"]
    s3_key = f"videos/{candidate_id}/{token}/recording_backup.webm"

    try:
        s3_client.upload_fileobj(
            file.file, S3_INTERVIEW_BUCKET, s3_key,
            ExtraArgs={"ContentType": "video/webm"}
        )
        return {"status": "ok", "s3_key": s3_key}
    except Exception as e:
        return {"error": f"S3 upload failed: {e}"}


@app.post("/api/upload_snapshot")
async def upload_snapshot(
    token: str = Form(...),
    timestamp: float = Form(...),
    flag_type: str = Form(...),
    description: str = Form(""),
    file: UploadFile = File(...)
):
    Token = Query()
    record = interview_tokens_table.get(Token.token == token)
    if not record:
        return {"error": "Invalid token"}

    candidate_id = record["candidate_id"]
    safe_ts = f"{timestamp:.1f}".replace(".", "_")
    s3_key = f"snapshots/{candidate_id}/{token}/{safe_ts}s_{flag_type}.jpg"

    try:
        s3_client.upload_fileobj(
            file.file, S3_INTERVIEW_BUCKET, s3_key,
            ExtraArgs={"ContentType": "image/jpeg"}
        )

        # Generate presigned URL for snapshot
        snapshot_url = s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": S3_INTERVIEW_BUCKET, "Key": s3_key},
            ExpiresIn=7 * 24 * 3600
        )

        # Save flag to candidate DB
        candidate_data = get_candidate_by_id(candidate_id)
        if candidate_data:
            proctoring = candidate_data.get("proctoring", {"flags": [], "video_s3_key": ""})
            proctoring["flags"].append({
                "timestamp": timestamp,
                "type": flag_type,
                "description": description,
                "snapshot_s3_key": s3_key,
                "snapshot_url": snapshot_url,
                "created_at": datetime.utcnow().isoformat()
            })
            candidate_data["proctoring"] = proctoring
            save_candidate(candidate_data)

        return {"status": "ok", "s3_key": s3_key, "url": snapshot_url}
    except Exception as e:
        return {"error": f"S3 upload failed: {e}"}


@app.post("/api/upload_final_video")
async def upload_final_video(
    token: str = Form(...),
    file: UploadFile = File(...)
):
    Token = Query()
    record = interview_tokens_table.get(Token.token == token)
    if not record:
        return {"error": "Invalid token"}

    candidate_id = record["candidate_id"]
    s3_key = f"videos/{candidate_id}/{token}/interview.webm"

    try:
        s3_client.upload_fileobj(
            file.file, S3_INTERVIEW_BUCKET, s3_key,
            ExtraArgs={"ContentType": "video/webm"}
        )

        # Generate presigned URL for video
        video_url = s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": S3_INTERVIEW_BUCKET, "Key": s3_key},
            ExpiresIn=7 * 24 * 3600
        )

        # Save video URL to candidate DB
        candidate_data = get_candidate_by_id(candidate_id)
        if candidate_data:
            proctoring = candidate_data.get("proctoring", {"flags": []})
            proctoring["video_s3_key"] = s3_key
            proctoring["video_url"] = video_url
            candidate_data["proctoring"] = proctoring
            save_candidate(candidate_data)

        return {"status": "ok", "s3_key": s3_key, "url": video_url}
    except Exception as e:
        return {"error": f"S3 upload failed: {e}"}


@app.get("/api/presigned_url")
async def get_presigned_url(s3_key: str = QueryParam(...)):
    try:
        url = s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": S3_INTERVIEW_BUCKET, "Key": s3_key},
            ExpiresIn=3600
        )
        return {"url": url}
    except Exception as e:
        return {"error": f"Failed to generate URL: {e}"}



