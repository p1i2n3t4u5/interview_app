import os
import json
import re
import random
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


# =========================
# Load environment
# =========================

load_dotenv()

AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_SESSION_TOKEN = os.getenv("AWS_SESSION_TOKEN")
AWS_REGION = os.getenv("AWS_DEFAULT_REGION", "us-east-1")

MODEL_ID = "us.anthropic.claude-3-5-sonnet-20241022-v2:0"



bedrock = boto3.client(
    "bedrock-runtime",
    region_name=AWS_REGION,
    aws_access_key_id=AWS_ACCESS_KEY_ID,
    aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
    aws_session_token=AWS_SESSION_TOKEN
)

ses = boto3.client(
    "ses",
    region_name=AWS_REGION,
    aws_access_key_id=AWS_ACCESS_KEY_ID,
    aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
    aws_session_token=AWS_SESSION_TOKEN
)

SENDER_EMAIL = os.getenv("SENDER_EMAIL", "")
BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")

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
# Database
# =========================

db = TinyDB("db.json")
candidates_table = db.table("candidates")
interview_tokens_table = db.table("interview_tokens")


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



def categorize_skills_llm(skills):
    prompt = f"""
You are a technical hiring expert.

Group the following technical skills into logical engineering categories.

Skills:
{skills}

Return JSON in this format:

{{
 "Backend":[],
 "Frontend":[],
 "Cloud":[],
 "DevOps":[],
 "Messaging":[],
 "Database":[],
 "Architecture":[],
 "Testing":[]
}}

Only include categories that have skills.
"""
    return extract_json_object(llm(prompt))






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
    transcript = data.get("transcript", [])
    skill_scores = compute_skill_scores(transcript)
    skill_categories = categorize_skills_llm(list(skill_scores.keys()))
    category_scores = compute_category_scores(skill_scores, skill_categories)

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
        "skill_scores": skill_scores,
        "skill_categories": skill_categories,
        "category_scores": category_scores,
        "report": report,
        "transcript": transcript
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
    total_questions: int = 0


def send_interview_email(to_email, candidate_name, interview_url):
    ses.send_email(
        Source=SENDER_EMAIL,
        Destination={"ToAddresses": [to_email]},
        Message={
            "Subject": {"Data": "Your Interview Invitation", "Charset": "UTF-8"},
            "Body": {
                "Html": {
                    "Charset": "UTF-8",
                    "Data": f"""
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
                }
            }
        }
    )


@app.post("/send_email")
def send_email(payload: EmailRequest):
    candidate = get_candidate_by_id(payload.id)
    if not candidate:
        return {"error": "Candidate not found"}

    token = generate_interview_token(payload.id, payload.email, payload.name)
    interview_url = f"{BASE_URL}/interview?token={token}"

    # Store custom question count if provided
    if payload.total_questions > 0:
        Token = Query()
        interview_tokens_table.update(
            {"total_questions": payload.total_questions},
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
        "jd_skills": candidate.get("jd_skills", []) if candidate else []
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

TASK 2 - Generate the next question:
- If the answer appears shallow, ask a DEEPER follow-up on the SAME topic to help the candidate demonstrate their understanding
- Otherwise, move to a new skill area from the resume/JD
- Progress difficulty as the interview progresses
- Cover diverse skills across the interview
- Question {question_number} of {total_questions} total

CRITICAL RULES:
1. NEVER repeat a question you already asked. Each question MUST be unique and different from all previous questions in the transcript.
2. ALWAYS generate a proper TECHNICAL question. Never generate interview management messages, termination notices, or meta-commentary.
3. The next_question.question field must ONLY contain a technical interview question, nothing else.
4. Even if candidate answers poorly, stay professional and keep asking new technical questions.
5. NEVER tell the candidate the interview is terminated or that they failed. Just keep asking questions.
6. Be encouraging - if a candidate struggles, simplify the question or move to a different topic.
7. NEVER include phrases like "interview terminated", "qualification misrepresentation", "blacklisting", "fraud", or similar harsh language.
8. Score fairly but keep moving forward with new questions regardless of scores.

Return ONLY this JSON:
{{
  "analysis": {{
    "score": 0,
    "is_correct": true,
    "appears_authentic": true,
    "depth": "shallow",
    "strengths": [],
    "weaknesses": [],
    "feedback": "",
    "follow_up_needed": false,
    "follow_up_reason": ""
  }},
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
    response = bedrock.invoke_model(
        modelId=MODEL_ID,
        body=body,
        contentType="application/json",
        accept="application/json"
    )
    result = json.loads(response["body"].read())
    return extract_json_object(result["content"][0]["text"])


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

    try:
        # Step 1: Greeting
        greeting_text = generate_greeting(candidate_name, resume_text, jd_text, total_questions)
        try:
            greeting_audio = synthesize_speech(greeting_text)
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

        # Step 2: First question
        first_q = generate_first_question(candidate_name, resume_text, jd_text)
        current_question = first_q.get("question", "Tell me about your experience.")
        current_skill = first_q.get("skill_area", "general")
        current_difficulty = first_q.get("difficulty", "beginner")

        question_number = 1

        while question_number <= total_questions:
            # Send question
            try:
                question_audio = synthesize_speech(current_question)
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

            # Analyze answer + generate next question
            result = process_answer_and_generate_next(
                candidate_name, resume_text, jd_text,
                ai_transcript, current_question, answer_text,
                current_skill, question_number, total_questions
            )

            analysis = result.get("analysis", {})
            next_q = result.get("next_question", {})

            # Save to transcript
            entry = {
                "question_number": question_number,
                "type": "follow_up" if next_q.get("is_follow_up") else "question",
                "question": current_question,
                "answer": answer_text,
                "skill_area": current_skill,
                "difficulty": current_difficulty,
                "analysis": analysis,
                "timestamp": datetime.utcnow().isoformat()
            }
            ai_transcript.append(entry)

            # Save progress to DB
            candidate_data = get_candidate_by_id(record["candidate_id"])
            candidate_data["ai_interview_transcript"] = ai_transcript
            save_candidate(candidate_data)

            # Prepare next question
            current_question = next_q.get("question", "Tell me more about your experience.")
            current_skill = next_q.get("skill_area", "general")
            current_difficulty = next_q.get("difficulty", "intermediate")

            question_number += 1

        # Interview complete
        scores = [e["analysis"].get("score", 0) for e in ai_transcript if "analysis" in e]
        avg_score = round(sum(scores) / len(scores), 2) if scores else 0

        completion_text = f"Thank you {candidate_name} for completing the interview. We appreciate your time and will get back to you soon."
        try:
            completion_audio = synthesize_speech(completion_text)
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



def compute_category_scores(skill_scores, skill_categories):

    category_scores = {}
    for category, skills in skill_categories.items():
        scores = [
            skill_scores[s]
            for s in skills
            if s in skill_scores
        ]
        if scores:
            category_scores[category] = sum(scores) / len(scores)
    return category_scores
