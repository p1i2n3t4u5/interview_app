
STEPS TO RUN
------------

# Create virtual environment (optional but recommended)
python3 -m venv .venv
# Activate venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

# Install all required libraries
pip install fastapi uvicorn python-dotenv boto3 faiss-cpu numpy pdfplumber tinydb python-multipart 'uvicorn[standard]

Breakdown of libraries
-----------------------
Library	Purpose
fastapi	Web framework for API endpoints & WebSocket
uvicorn	ASGI server to run FastAPI
python-dotenv	Load AWS credentials from .env
boto3	AWS SDK (for Bedrock, optional Polly later)
faiss-cpu	Vector similarity search for RAG
numpy	Numerical operations & embeddings
pdfplumber	Extract text from PDF resumes & JDs
tinydb	File-based database to persist candidates & transcripts
uvicorn[standard] Uvicorn needs a WebSocket protocol library. The basic uvicorn package doesn't include one.


Start server
------------
run in terminal ->  uvicorn interview_app:app --reload

URIs
--------
swagger UI :  http://localhost:8000/docs#/
UI : http://localhost:8000
uvicorn interview_app:app --reload


Flow diagram
-------------

      +-------------------+
      | Upload Resume PDF |
      +--------+----------+
               |
               v
      +-------------------+
      |  PDF Text Extract |
      |   (pdfplumber)   |
      +--------+----------+
               |
               v
      +-------------------+
      |  Parse Resume via |
      |  LLM (Bedrock)   |
      +--------+----------+
               |
               v
      +-------------------+
      | Candidate Skills  |
      | & Technologies   |
      +--------+----------+
               |
               v
      +-------------------+
      | Upload JD PDF     |
      +--------+----------+
               |
               v
      +-------------------+
      | Parse JD Skills   |
      | via LLM           |
      +--------+----------+
               |
               v
      +-------------------+
      | Skill Matching    |
      | Candidate vs JD   |
      +--------+----------+
               |
               v
      +-------------------+
      | RAG Knowledge Base|
      |  (FAISS + Bedrock |
      |  Embeddings)      |
      +--------+----------+
               |
               v
      +-------------------+
      | Generate Next     |
      | Interview Question|
      | via LLM           |
      +--------+----------+
               |
               v
      +-------------------+
      | Candidate Answers |
      +--------+----------+
               |
               v
      +-------------------+
      | Submit Transcript |
      +--------+----------+
               |
               v
      +-------------------+
      | Transcript Analysis|
      | (Strengths, Weaknesses,
      | Communication)     |
      +--------+----------+
               |
               v
      +-------------------+
      | Skill Scoring     |
      | (1-10 per skill)  |
      +--------+----------+
               |
               v
      +-------------------+
      | Final Evaluation  |
      | Recommendation    |
      | (Hire / No Hire / |
      | Borderline)       |
      +-------------------+