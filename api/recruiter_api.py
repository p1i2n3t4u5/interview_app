# ---- START: Ishita - Recruiter API: enhanced candidate list, batch JD gap analysis, search, AI-powered candidate summary (Bedrock) ----
"""
Recruiter API — New endpoints for the recruiter dashboard.
Mount this router into the main FastAPI app.
"""

import json
import os
from fastapi import APIRouter, UploadFile, File, Form
from tinydb import TinyDB, Query

router = APIRouter(prefix="/recruiter", tags=["recruiter"])

# These will be injected by the main app
db = None
candidates_table = None
extract_pdf_text = None
extract_jd_skills = None
llm = None


def init(app_db, app_candidates_table, app_extract_pdf_text, app_extract_jd_skills, app_llm):
    """Call this from the main app to inject shared dependencies."""
    global db, candidates_table, extract_pdf_text, extract_jd_skills, llm
    db = app_db
    candidates_table = app_candidates_table
    extract_pdf_text = app_extract_pdf_text
    extract_jd_skills = app_extract_jd_skills
    llm = app_llm


# =========================
# Enhanced Candidates List
# =========================

@router.get("/candidates")
def list_candidates_enhanced():
    """Returns enriched candidate list for the recruiter dashboard."""
    candidates = candidates_table.all()
    result = []
    for c in candidates:
        result.append({
            "candidate_id": c.get("id", ""),
            "name": c.get("name", ""),
            "email": c.get("email", ""),
            "phone": c.get("phone", ""),
            "location": c.get("location", ""),
            "skills": c.get("candidate_skills", []),
            "years_experience": c.get("years_experience", 0),
            "interview_status": c.get("interview_status", "not_started"),
            "interview_score": c.get("interview_average_score", 0),
            "match_percent": _compute_match_pct(c),
            "has_jd": bool(c.get("jd_skills")),
            "has_transcript": len(c.get("ai_interview_transcript", c.get("transcript", []))) > 0,
        })
    return {
        "total_candidates": len(result),
        "candidates": result
    }


# =========================
# Single Candidate Detail
# =========================

@router.get("/candidate/{candidate_id}")
def get_candidate_detail(candidate_id: str):
    """Full candidate profile for the candidate page."""
    Candidate = Query()
    data = candidates_table.get(Candidate.id == candidate_id)
    if not data:
        return {"error": "Candidate not found"}
    return data


# =========================
# JD Gap Analysis (batch)
# =========================

@router.post("/jd_gap_analysis")
async def jd_gap_analysis_batch(
    jd_file: UploadFile = File(...),
    candidate_ids: str = Form(...)
):
    """
    Upload a JD and get gap analysis for multiple candidates at once.
    Returns matched/missing skills per candidate.
    """
    candidate_id_list = json.loads(candidate_ids)

    # Save and parse JD
    upload_dir = "uploads"
    os.makedirs(upload_dir, exist_ok=True)
    path = os.path.join(upload_dir, "temp_recruiter_jd.pdf")
    with open(path, "wb") as f:
        f.write(await jd_file.read())

    jd_text = extract_pdf_text(path)
    jd_skills = extract_jd_skills(jd_text)
    jd_skills_lower = set(s.lower() for s in jd_skills)

    Candidate = Query()
    results = []

    for cid in candidate_id_list:
        c = candidates_table.get(Candidate.id == cid)
        if not c:
            continue

        c_skills = c.get("candidate_skills", [])
        c_skills_lower = set(s.lower() for s in c_skills)

        matched = [s for s in jd_skills if s.lower() in c_skills_lower]
        missing = [s for s in jd_skills if s.lower() not in c_skills_lower]
        match_pct = round(len(matched) / len(jd_skills) * 100, 2) if jd_skills else 0

        # Store JD data on candidate
        c["jd"] = jd_text
        c["jd_skills"] = jd_skills
        candidates_table.upsert(c, Candidate.id == cid)

        results.append({
            "candidate_id": cid,
            "name": c.get("name", ""),
            "matched_skills": matched,
            "missing_skills": missing,
            "match_percent": match_pct,
            "total_candidate_skills": len(c_skills),
        })

    return {
        "jd_skills": jd_skills,
        "total_analyzed": len(results),
        "results": results
    }


# =========================
# Search Candidates
# =========================

@router.get("/search")
def search_candidates(q: str = ""):
    """Search candidates by name, skills, ID, email."""
    query = q.lower().strip()
    if not query:
        return {"candidates": []}

    candidates = candidates_table.all()
    results = []
    for c in candidates:
        name = c.get("name", "").lower()
        cid = c.get("id", "").lower()
        email = c.get("email", "").lower()
        skills = [s.lower() for s in c.get("candidate_skills", [])]

        if (query in name or query in cid or query in email or
                any(query in s for s in skills)):
            results.append({
                "candidate_id": c.get("id", ""),
                "name": c.get("name", ""),
                "email": c.get("email", ""),
                "skills": c.get("candidate_skills", []),
                "interview_status": c.get("interview_status", "not_started"),
                "interview_score": c.get("interview_average_score", 0),
            })

    return {"candidates": results, "total": len(results)}


# =========================
# AI-Powered Candidate Summary (Bedrock)
# =========================

@router.get("/candidate/{candidate_id}/ai_summary")
def ai_candidate_summary(candidate_id: str):
    """Generate an AI-powered summary of a candidate using Bedrock."""
    Candidate = Query()
    c = candidates_table.get(Candidate.id == candidate_id)
    if not c:
        return {"error": "Candidate not found"}

    transcript = c.get("ai_interview_transcript", c.get("transcript", []))
    skills = c.get("candidate_skills", [])
    jd_skills = c.get("jd_skills", [])

    prompt = f"""You are a senior technical recruiter AI assistant powered by AWS Bedrock.

Candidate: {c.get('name', 'Unknown')}
Skills: {', '.join(skills)}
JD Required Skills: {', '.join(jd_skills)}
Years Experience: {c.get('years_experience', 'Unknown')}
Interview Status: {c.get('interview_status', 'not_started')}
Interview Score: {c.get('interview_average_score', 'N/A')}
Number of Interview Questions: {len(transcript)}

Generate a concise recruiter summary with:
1. Overall assessment (2-3 sentences)
2. Top 3 strengths
3. Top 3 areas of concern
4. Hiring recommendation (Strong Hire / Hire / Borderline / No Hire)
5. Suggested next steps

Return as JSON:
{{
  "assessment": "",
  "strengths": [],
  "concerns": [],
  "recommendation": "",
  "next_steps": ""
}}"""

    try:
        result = llm(prompt)
        import re
        json_match = re.search(r'\{.*\}', result, re.DOTALL)
        if json_match:
            return json.loads(json_match.group())
        return {"assessment": result}
    except Exception as e:
        return {"error": str(e)}


# =========================
# Helpers
# =========================

def _compute_match_pct(candidate):
    c_skills = set(s.lower() for s in candidate.get("candidate_skills", []))
    j_skills = set(s.lower() for s in candidate.get("jd_skills", []))
    if not j_skills:
        return 0
    return round(len(c_skills & j_skills) / len(j_skills) * 100, 2)

# ---- END: Ishita - Recruiter API ----
