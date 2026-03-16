// ===========================
// app.js
// ===========================
let selectedCandidateGapId = '';
let selectedCandidateInterviewId = '';
let selectedCandidateReportId = '';
let wsInterview = null;

// ===========================
// Helper: Fetch all candidates
// ===========================
async function fetchAllCandidates() {
    const res = await fetch('/get_candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jd_text: '', top_n: 100 })
    });
    const data = await res.json();
    return data.top_candidates || [];
}

// ===========================
// Candidate Search - Gap Analysis
// ===========================
async function searchCandidateGap() {
    const query = document.getElementById('candidateSearchGap').value.trim().toLowerCase();
    const selectEl = document.getElementById('candidateSelectGap');
    selectEl.innerHTML = '<option value="">Select Candidate</option>';
    if (!query) return;

    const candidates = await fetchAllCandidates();
    const matches = candidates.filter(c => c.name.toLowerCase().includes(query));

    matches.forEach(c => {
        let opt = document.createElement('option');
        opt.value = c.id;
        opt.text = `${c.name} - ${c.match_score || 0}%`;
        selectEl.add(opt);
    });

    document.getElementById('gapSearchResult').textContent = `${matches.length} candidates found`;
}

function selectCandidateGap() {
    selectedCandidateGapId = document.getElementById('candidateSelectGap').value;
}

// ===========================
// Candidate Search - Interview
// ===========================
async function searchCandidateInterview() {
    const query = document.getElementById('candidateSearchInterview').value.trim().toLowerCase();
    const selectEl = document.getElementById('candidateSelectInterview');
    selectEl.innerHTML = '<option value="">Select Candidate</option>';
    if (!query) return;

    const candidates = await fetchAllCandidates();
    const matches = candidates.filter(c => c.name.toLowerCase().includes(query));

    matches.forEach(c => {
        let opt = document.createElement('option');
        opt.value = c.id;
        opt.text = `${c.name} - ${c.match_score || 0}%`;
        selectEl.add(opt);
    });

    document.getElementById('interviewSearchResult').textContent = `${matches.length} candidates found`;
}

async function selectCandidateInterview() {
    selectedCandidateInterviewId = document.getElementById('candidateSelectInterview').value;
    if (!selectedCandidateInterviewId) return;

    const data = await fetch(`/get_candidate/${selectedCandidateInterviewId}`).then(res => res.json());
    document.getElementById('candidateNameInterview').value = data.name;
    document.getElementById('interviewArea').style.display = 'block';
    document.getElementById('transcriptArea').textContent = JSON.stringify(data.transcript || [], null, 2);
}

// ===========================
// Candidate Search - Report
// ===========================
async function searchCandidateReport() {
    const query = document.getElementById('candidateSearchReport').value.trim().toLowerCase();
    const selectEl = document.getElementById('candidateSelectReport');
    selectEl.innerHTML = '<option value="">Select Candidate</option>';
    if (!query) return;

    const candidates = await fetchAllCandidates();
    const matches = candidates.filter(c => c.name.toLowerCase().includes(query));

    matches.forEach(c => {
        let opt = document.createElement('option');
        opt.value = c.id;
        opt.text = `${c.name} - ${c.match_score || 0}%`;
        selectEl.add(opt);
    });

    document.getElementById('reportSearchResult').textContent = `${matches.length} candidates found`;
}

function selectCandidateReport() {
    selectedCandidateReportId = document.getElementById('candidateSelectReport').value;
    if (!selectedCandidateReportId) return;
    document.getElementById('candidateNameReport').value = document.getElementById('candidateSelectReport').selectedOptions[0].text.split(' - ')[0];
}

// ===========================
// Resume Upload
// ===========================
async function uploadResume() {
    const candidate = document.getElementById('candidateNameResume').value.trim();
    const file = document.getElementById('resumeFile').files[0];
    if (!candidate || !file) return alert('Enter candidate name and select a resume');

    const form = new FormData();
    form.append('file', file);

    const res = await fetch(`/upload_resume/${candidate}`, { method: 'POST', body: form });
    const data = await res.json();
    document.getElementById('resumeResult').textContent = JSON.stringify(data, null, 2);
}

async function uploadMultipleResumes() {
    const files = document.getElementById('multiResumes').files;
    if (!files.length) return alert('Select files to upload');

    const form = new FormData();
    for (const f of files) form.append('files', f);

    const res = await fetch('/upload_resumes', { method: 'POST', body: form });
    const data = await res.json();
    document.getElementById('resumeResult').textContent = JSON.stringify(data, null, 2);
}

// ===========================
// Gap Analysis
// ===========================
async function gapAnalysisNew() {
    if (!selectedCandidateGapId) return alert('Select candidate for Gap Analysis');
    const file = document.getElementById('jdGapFile').files[0];
    if (!file) return alert('Select JD file');

    const form = new FormData();
    form.append('file', file);

    const res = await fetch(`/candidate_gap_analysis/${selectedCandidateGapId}`, { method: 'POST', body: form });
    const data = await res.json();
    document.getElementById('gapResult').textContent = JSON.stringify(data, null, 2);
}

// ===========================
// Compare Candidates
// ===========================
async function compareCandidates() {
    const jdFile = document.getElementById('compareJD').files[0];
    const resumes = document.getElementById('compareResumes').files;
    const topN = parseInt(document.getElementById('topN').value || 5);
    if (!jdFile || !resumes.length) return alert('Select JD and resume files');

    const form = new FormData();
    form.append('jd_file', jdFile);
    for (const f of resumes) form.append('resumes', f);
    form.append('top_n', topN);

    const res = await fetch('/compare_candidates', { method: 'POST', body: form });
    const data = await res.json();
    document.getElementById('rankingResult').textContent = JSON.stringify(data, null, 2);
}

// ===========================
// Knowledge Base
// ===========================
async function uploadKnowledge() {
    const file = document.getElementById('knowledgeFile').files[0];
    if (!file) return alert('Select knowledge file');

    const form = new FormData();
    form.append('file', file);

    const res = await fetch('/upload_knowledge', { method: 'POST', body: form });
    const data = await res.json();
    document.getElementById('knowledgeResult').textContent = JSON.stringify(data, null, 2);
}

async function listKnowledge() {
    const res = await fetch('/knowledge_files');
    const data = await res.json();
    document.getElementById('knowledgeResult').textContent = JSON.stringify(data, null, 2);
}

// ===========================
// AI Interview
// ===========================
function startInterview() {
    if (!selectedCandidateInterviewId) return alert('Select candidate');
    wsInterview = new WebSocket(`ws://${window.location.host}/ws/interview/${selectedCandidateInterviewId}`);
    const questionBox = document.getElementById('questionBox');

    wsInterview.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        if (data.question) questionBox.textContent = data.question;
        if (data.message) questionBox.textContent = data.message;
    };
    wsInterview.onclose = () => alert('Interview ended');
}

function sendAnswer() {
    if (!wsInterview || wsInterview.readyState !== WebSocket.OPEN) return alert('Interview not started');
    const answer = document.getElementById('answerInput').value.trim();
    if (!answer) return alert('Type your answer');

    wsInterview.send(answer);

    // Append to transcript area
    const transcriptArea = document.getElementById('transcriptArea');
    let transcript = [];
    try { transcript = JSON.parse(transcriptArea.textContent); } catch {}
    transcript.push({ answer });
    transcriptArea.textContent = JSON.stringify(transcript, null, 2);
    document.getElementById('answerInput').value = '';
}

function startVoice() {
    if (!('webkitSpeechRecognition' in window)) {
        return alert("Voice not supported in this browser");
    }
    const recognition = new webkitSpeechRecognition();
    recognition.lang = 'en-US';
    recognition.onresult = function(event) {
        const spoken = event.results[0][0].transcript;
        document.getElementById("answerInput").value = spoken;
    }
    recognition.start();
}

// ===========================
// Submit / Get Transcript
// ===========================
async function submitTranscript() {
    if (!selectedCandidateInterviewId) return alert('Select candidate');
    const transcriptText = document.getElementById('transcriptArea').textContent || '[]';
    let transcript = [];
    try { transcript = JSON.parse(transcriptText); } catch {}
    const res = await fetch(`/submit_transcript/${selectedCandidateInterviewId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transcript)
    });
    const data = await res.json();
    alert(`Transcript saved for candidate. Total questions: ${data.total_questions}`);
}

async function getReport() {
    if (!selectedCandidateReportId) return alert('Select candidate');
    const data = await fetch(`/interview_report/${selectedCandidateReportId}`).then(r => r.json());
    document.getElementById('reportResult').textContent = JSON.stringify(data, null, 2);
}

async function getAnalytics() {
    const data = await fetch(`/analytics`).then(r => r.json());
    document.getElementById('analyticsResult').textContent = JSON.stringify(data, null, 2);
}

let candidatesList = [];
let selectedCandidate = null;

// Fetch all candidates on page load
async function fetchAllCandidates() {
    const res = await fetch("/get_candidates");
    candidatesList = await res.json(); // Expecting: [{id, name, candidate_skills, resume}]
    populateCandidateSelect(candidatesList);
}

// Populate dropdown
function populateCandidateSelect(list) {
    const select = document.getElementById("candidateSelectGap");
    select.innerHTML = `<option value="">Select Candidate</option>`;
    list.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.text = c.name;
        select.appendChild(opt);
    });
}

// Filter candidates by search box
function searchCandidateGap() {
    const q = document.getElementById("candidateSearchGap").value.toLowerCase();
    const filtered = candidatesList.filter(c => c.name.toLowerCase().includes(q));
    populateCandidateSelect(filtered);
}

// Select candidate from dropdown
function selectCandidateGap() {
    const id = document.getElementById("candidateSelectGap").value;
    selectedCandidate = candidatesList.find(c => c.id === id);
    document.getElementById("gapSearchResult").textContent = selectedCandidate
        ? `Selected: ${selectedCandidate.name}\nSkills: ${selectedCandidate.candidate_skills.join(", ")}`
        : "";
}

// Upload JD & compute gap
async function gapAnalysisNew() {
    if (!selectedCandidate) {
        alert("Please select a candidate first.");
        return;
    }
    const fileInput = document.getElementById("jdGapFile");
    if (fileInput.files.length === 0) {
        alert("Please upload a JD file.");
        return;
    }

    const formData = new FormData();
    formData.append("jd", fileInput.files[0]);
    formData.append("candidate_id", selectedCandidate.id);

    const res = await fetch("/analyze_gap", {
        method: "POST",
        body: formData
    });

    const data = await res.json();
    document.getElementById("gapResult").textContent = JSON.stringify(data, null, 2);
}

// Load candidates when page loads
fetchAllCandidates();