# ---- START: Ishita - Candidate API: full profile, AI insights via Bedrock, matching jobs/JDs, progress tracking ----
"""
Candidate API — Endpoints for the candidate detail page.
Mount this router into the main FastAPI app.
"""

import json
import re
from fastapi import APIRouter
from tinydb import Query

router = APIRouter(prefix="/candidate_api", tags=["candidate"])

# Injected from main app
candidates_table = None
llm = None
compute_skill_scores = None


def init(app_candidates_table, app_llm, app_compute_skill_scores):
    """Inject shared dependencies from the main app."""
    global candidates_table, llm, compute_skill_scores
    candidates_table = app_candidates_table
    llm = app_llm
    compute_skill_scores = app_compute_skill_scores


# =========================
# Full Candidate Profile
# =========================

@router.get("/profile/{candidate_id}")
def candidate_profile(candidate_id: str):
    """Returns everything needed for the candidate profile page."""
    Candidate = Query()
    c = candidates_table.get(Candidate.id == candidate_id)
    if not c:
        return {"error": "Candidate not found"}

    # Compute interview metrics
    transcript = c.get("ai_interview_transcript", c.get("transcript", []))
    skill_scores = _compute_interview_skill_scores(transcript)

    # Determine progress stage
    progress = _determine_progress(c)

    return {
        **c,
        "computed_skill_scores": skill_scores,
        "progress_stage": progress,
        "total_interview_questions": len(transcript),
    }


# =========================
# AI Interview Insights (Bedrock)
# =========================

@router.get("/insights/{candidate_id}")
def candidate_insights(candidate_id: str):
    """AI-generated insights about the candidate's interview performance."""
    Candidate = Query()
    c = candidates_table.get(Candidate.id == candidate_id)
    if not c:
        return {"error": "Candidate not found"}

    transcript = c.get("ai_interview_transcript", [])
    if not transcript:
        return {"message": "No interview data available for analysis."}

    # Build transcript summary for the prompt
    transcript_summary = ""
    for item in transcript:
        if item.get("analysis"):
            transcript_summary += f"\nQ: {item.get('question', '')[:150]}\nScore: {item['analysis'].get('score', 'N/A')}/10\nStrengths: {item['analysis'].get('strengths', [])}\nWeaknesses: {item['analysis'].get('weaknesses', [])}\n"

    prompt = f"""You are an expert technical recruiter AI powered by AWS Bedrock. Analyze this candidate's interview performance.

Candidate: {c.get('name', 'Unknown')}
Skills on Resume: {', '.join(c.get('candidate_skills', []))}
JD Required Skills: {', '.join(c.get('jd_skills', []))}
Average Score: {c.get('interview_average_score', 'N/A')}

Interview Transcript Summary:
{transcript_summary[:3000]}

Provide deep analysis as JSON:
{{
  "overall_assessment": "",
  "technical_depth": "strong|moderate|shallow",
  "communication_rating": "excellent|good|average|poor",
  "key_strengths": [],
  "key_gaps": [],
  "red_flags": [],
  "hiring_confidence": 0,
  "recommended_role_level": "",
  "follow_up_topics": [],
  "summary": ""
}}"""

    try:
        result = llm(prompt)
        json_match = re.search(r'\{.*\}', result, re.DOTALL)
        if json_match:
            return json.loads(json_match.group())
        return {"summary": result}
    except Exception as e:
        return {"error": str(e)}


# =========================
# Matching Jobs / JDs
# =========================

@router.get("/matching_jobs/{candidate_id}")
def matching_jobs(candidate_id: str):
    """Find which JDs / candidates this person's skills match with."""
    Candidate = Query()
    c = candidates_table.get(Candidate.id == candidate_id)
    if not c:
        return {"error": "Candidate not found"}

    c_skills = set(s.lower() for s in c.get("candidate_skills", []))

    # Check all other candidates who have JDs to find matching job descriptions
    all_candidates = candidates_table.all()
    matches = []
    seen_jds = set()

    for other in all_candidates:
        jd_text = other.get("jd", "")
        jd_skills = other.get("jd_skills", [])
        if not jd_skills:
            continue

        # Hash JD to avoid duplicates
        jd_hash = hash(jd_text[:200]) if jd_text else hash(str(jd_skills))
        if jd_hash in seen_jds:
            continue
        seen_jds.add(jd_hash)

        j_skills = set(s.lower() for s in jd_skills)
        matched = c_skills & j_skills
        if matched:
            match_pct = round(len(matched) / len(j_skills) * 100, 2) if j_skills else 0
            matches.append({
                "jd_snippet": jd_text[:300] if jd_text else "N/A",
                "jd_skills": jd_skills,
                "matched_skills": list(matched),
                "missing_skills": list(j_skills - c_skills),
                "match_percent": match_pct,
            })

    matches.sort(key=lambda x: x["match_percent"], reverse=True)
    return {"matching_jobs": matches[:10]}


# =========================
# Helpers
# =========================

def _compute_interview_skill_scores(transcript):
    scores = {}
    for item in transcript:
        analysis = item.get("analysis", {})
        score = analysis.get("score", 0)
        skill = item.get("skill_area", item.get("skill", "General"))
        if score > 0:
            scores.setdefault(skill, []).append(score)
    return {k: round(sum(v) / len(v), 1) for k, v in scores.items()}


def _determine_progress(c):
    """Determine the current stage of the candidature."""
    if c.get("interview_average_score", 0) > 0:
        return 5  # Evaluated
    if c.get("interview_status") == "completed":
        return 4  # Interview completed
    if c.get("interview_status") in ("pending", "active"):
        return 3  # Interview scheduled
    if c.get("jd_skills"):
        return 2  # JD analyzed
    if c.get("candidate_skills"):
        return 1  # Skills extracted
    return 0  # Resume uploaded

# ---- END: Ishita - Candidate API ----
