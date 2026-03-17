// =========================
// Merged from interview_app_old + interview_app — Full recruiter dashboard logic:
// bulk resume upload, JD upload, AI candidate matching, search, candidate/job listing,
// compare, knowledge base, reports & analytics, submit transcript
// =========================
let ws;
let currentCandidate = "";
let currentJobId = "";
let allCandidatesCache = [];

// =========================
// Init — Load candidates on startup
// =========================
document.addEventListener("DOMContentLoaded", () => {
    loadCandidatesForDropdowns();
});

async function loadCandidatesForDropdowns() {
    try {
        const res = await fetch("/candidates");
        const data = await res.json();
        allCandidatesCache = data.candidates || [];
        populateDropdown("candidateSelectReport", allCandidatesCache);
        populateDropdown("candidateSelectSubmitTranscript", allCandidatesCache);
        populateJDCandidateCheckboxes();
    } catch (e) {
        console.error("Failed to load candidates:", e);
    }
}

function populateDropdown(selectId, candidates) {
    const dd = document.getElementById(selectId);
    if (!dd) return;
    dd.innerHTML = '<option value="">Select Candidate</option>';
    candidates.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c.candidate_id;
        opt.textContent = c.name + " (" + c.candidate_id + ")";
        dd.appendChild(opt);
    });
}

// =========================
// Section Navigation
// =========================
function showSection(sectionId) {
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    ['uploadSection', 'jdSection', 'matchResults', 'candidatesSection', 'jobsSection',
     'searchResults', 'inviteSection', 'compareSection', 'knowledgeSection', 'submitTranscriptSection'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    const target = document.getElementById(sectionId);
    if (target) {
        target.classList.remove('hidden');
        if (sectionId === 'candidatesSection') loadAllCandidates();
        if (sectionId === 'jobsSection') loadAllJobs();
    }
    if (event && event.target) event.target.classList.add('active');
}

function showDashboard() {
    document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
    document.getElementById('uploadSection').classList.remove('hidden');
    document.getElementById('jdSection').classList.remove('hidden');
    document.getElementById('inviteSection').classList.remove('hidden');
    const submitEl = document.getElementById('submitTranscriptSection');
    if (submitEl) submitEl.classList.remove('hidden');
    if (currentJobId) document.getElementById('matchResults').classList.remove('hidden');
}

// =========================
// Resume Upload
// =========================
function handleResumeSelect() {
    const files = document.getElementById('resumeFiles').files;
    const list = document.getElementById('resumeFileList');
    list.innerHTML = '';
    if (files.length > 0) {
        document.getElementById('uploadResumeBtn').disabled = false;
        for (const f of files) {
            const div = document.createElement('div');
            div.className = 'file-item';
            div.textContent = `📄 ${f.name} (${(f.size / 1024).toFixed(1)} KB)`;
            list.appendChild(div);
        }
    }
}

// Drag and drop
const dropZone = document.getElementById('resumeDropZone');
if (dropZone) {
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        document.getElementById('resumeFiles').files = e.dataTransfer.files;
        handleResumeSelect();
    });
    dropZone.addEventListener('click', (e) => {
        if (e.target.id === 'resumeFiles') return;
        document.getElementById('resumeFiles').click();
    });
}

async function uploadResumes() {
    const files = document.getElementById('resumeFiles').files;
    if (!files.length) return alert("Select at least one PDF resume");

    const progress = document.getElementById('uploadProgress');
    const fill = document.getElementById('uploadProgressFill');
    const text = document.getElementById('uploadProgressText');
    progress.classList.remove('hidden');
    fill.style.width = '20%';
    text.textContent = `Analyzing ${files.length} resume(s) with AI...`;
    document.getElementById('uploadResumeBtn').disabled = true;

    const formData = new FormData();
    for (const f of files) formData.append("files", f);

    try {
        fill.style.width = '50%';
        const res = await fetch('/upload_resumes', { method: 'POST', body: formData });
        const data = await res.json();
        fill.style.width = '100%';
        text.textContent = `✅ ${data.total_uploaded} candidate(s) analyzed successfully!`;

        // Map upload response to match renderCandidateCards format
        const candidates = (data.candidates || []).map(c => ({
            candidate_id: c.candidate_id,
            name: c.parsed_resume?.name || c.candidate_id,
            skills: c.parsed_resume?.skills || [],
            years_experience: c.parsed_resume?.years_experience || 0
        }));
        renderCandidateCards(candidates, 'uploadedCandidates');
    } catch (err) {
        text.textContent = `❌ Error: ${err.message}`;
    }
}

// =========================
// JD Upload
// =========================
async function uploadJob() {
    const file = document.getElementById('jdFile').files[0];
    if (!file) return alert("Select a JD PDF file");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", "");

    const btn = document.querySelector('#jdSection .btn-primary');
    if (btn) { btn.textContent = '⏳ Analyzing...'; btn.disabled = true; }

    try {
        const res = await fetch('/upload_job', { method: 'POST', body: formData });
        const data = await res.json();
        currentJobId = data.job_id;

        document.getElementById('jdJobId').textContent = data.job_id;
        document.getElementById('jdTitle').textContent = data.title;

        const skillsEl = document.getElementById('jdSkills');
        skillsEl.innerHTML = data.jd_skills.map(s => `<span class="skill-tag">${s}</span>`).join('');

        document.getElementById('jdResult').classList.remove('hidden');
        populateJDCandidateCheckboxes();
    } catch (err) {
        alert('Error uploading JD: ' + err.message);
    } finally {
        if (btn) { btn.textContent = 'Upload JD'; btn.disabled = false; }
    }
}

// =========================
// Match Candidates
// =========================
async function matchCandidates() {
    if (!currentJobId) return alert("Upload a JD first");

    // Collapse the other panel and hide its results
    const findTopPanel = document.getElementById('findTopPanel');
    if (findTopPanel) findTopPanel.removeAttribute('open');
    document.getElementById('rankResults')?.classList.add('hidden');

    const btn = document.querySelector('#analyzeAllPanel .btn-accent');
    if (btn) { btn.textContent = '⏳ Matching with AI...'; btn.disabled = true; }

    try {
        const res = await fetch(`/match_job/${currentJobId}`, { method: 'POST' });
        const data = await res.json();

        document.getElementById('matchJobBadge').textContent = `${data.title} (${data.job_id})`;
        renderMatchResults(data.candidates, data.jd_skills);
        document.getElementById('matchResults').classList.remove('hidden');
    } catch (err) {
        alert('Error matching: ' + err.message);
    } finally {
        if (btn) { btn.textContent = '🔍 Run Analysis'; btn.disabled = false; }
    }
}

function renderMatchResults(candidates, jdSkills) {
    const container = document.getElementById('matchResultsList');
    container.innerHTML = '';

    if (!candidates.length) {
        container.innerHTML = '<p class="empty-state">No candidates found. Upload resumes first.</p>';
        return;
    }

    candidates.forEach((c, i) => {
        const card = document.createElement('div');
        card.className = 'candidate-card match-card';

        const matchClass = c.match_percent >= 70 ? 'match-high' : c.match_percent >= 40 ? 'match-mid' : 'match-low';

        const matchedTags = (c.matched_skills || []).map(s => `<span class="skill-tag skill-match">✅ ${s}</span>`).join('');
        const missingTags = (c.missing_skills || []).map(s => `<span class="skill-tag skill-miss">❌ ${s}</span>`).join('');

        card.innerHTML = `
            <div class="card-header">
                <div class="card-rank">#${i + 1}</div>
                <div class="card-info">
                    <span class="candidate-id">${c.candidate_id}</span>
                    <h3 class="candidate-name">${c.name}</h3>
                    <span class="candidate-exp">${c.years_experience || 0} yrs exp</span>
                </div>
                <div class="match-score ${matchClass}">${c.match_percent}%</div>
            </div>
            <div class="card-skills">${matchedTags}${missingTags}</div>
            <p class="card-summary">${c.ai_summary || ''}</p>
            <div class="card-actions">
                <a href="/candidate?id=${c.candidate_id}" class="btn-link">View Candidate →</a>
                <span class="status-pill status-${c.status || 'new'}">${c.status || 'new'}</span>
            </div>
        `;
        container.appendChild(card);
    });
}

// =========================
// Candidate Cards (for upload results & search)
// =========================
function renderCandidateCards(candidates, containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    candidates.forEach(c => {
        const card = document.createElement('div');
        card.className = 'candidate-card';

        const skillTags = (c.skills || c.candidate_skills || []).slice(0, 8)
            .map(s => `<span class="skill-tag">${s}</span>`).join('');

        card.innerHTML = `
            <div class="card-header">
                <div class="card-info">
                    <span class="candidate-id">${c.candidate_id}</span>
                    <h3 class="candidate-name">${c.name}</h3>
                    <span class="candidate-exp">${c.years_experience || 0} yrs exp</span>
                </div>
                ${c.best_match_percent ? `<div class="match-score match-mid">${c.best_match_percent}%</div>` : ''}
            </div>
            <div class="card-skills">${skillTags}</div>
            <div class="card-actions">
                <a href="/candidate?id=${c.candidate_id}" class="btn-link">View Candidate →</a>
            </div>
        `;
        container.appendChild(card);
    });
}

// =========================
// Search
// =========================
async function searchCandidates() {
    const q = document.getElementById('globalSearch').value.trim();
    if (!q) return;

    let candidates = [];
    try {
        const res = await fetch(`/candidates/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        candidates = data.candidates || [];
    } catch {
        // Fallback: filter from cached candidates
        candidates = allCandidatesCache.filter(c =>
            c.name.toLowerCase().includes(q.toLowerCase()) ||
            c.candidate_id.toLowerCase().includes(q.toLowerCase())
        );
    }

    document.getElementById('searchResults').classList.remove('hidden');
    renderCandidateCards(candidates, 'searchResultsList');
}

function hideSearch() {
    document.getElementById('searchResults').classList.add('hidden');
}

// =========================
// All Candidates
// =========================
async function loadAllCandidates() {
    const res = await fetch('/candidates');
    const data = await res.json();
    renderCandidateCards(data.candidates, 'allCandidatesList');
}

function filterCandidatesList() {
    const q = (document.getElementById('candidateSearchInList').value || '').toLowerCase();
    if (!allCandidatesCache.length) return;
    const filtered = allCandidatesCache.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.candidate_id || '').toLowerCase().includes(q)
    );
    renderCandidateCards(filtered, 'allCandidatesList');
}

async function generateReportForCandidate(candidateId, candidateName) {
    const panel = document.getElementById('candidateReportPanel');
    document.getElementById('reportCandidateName').textContent = candidateName || candidateId;
    document.getElementById('reportResult').textContent = 'Loading report...';
    document.getElementById('analyticsResult').textContent = '';
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth' });

    try {
        const res = await fetch(`/interview_report/${candidateId}`);
        const data = await res.json();
        document.getElementById('reportResult').textContent = JSON.stringify(data, null, 2);

        if (data.report) {
            const r = data.report;
            if (r.skill_scores) renderSkillRadar(r.skill_scores);
            if (r.score_trend) renderScoreTrend(r.score_trend);
            if (r.skill_scores) renderSkillScoreChart(r.skill_scores);
            if (r.strengths && r.weaknesses) renderStrengthWeaknessChart(r.strengths, r.weaknesses);
            if (r.skill_categories) renderSkillCategoryChart(r.skill_categories);
        }
    } catch (e) {
        document.getElementById('reportResult').textContent = 'Error generating report: ' + e.message;
    }
}

function closeCandidateReport() {
    document.getElementById('candidateReportPanel').classList.add('hidden');
}

// =========================
// All Jobs
// =========================
async function loadAllJobs() {
    const res = await fetch('/jobs');
    const data = await res.json();

    const container = document.getElementById('allJobsList');
    container.innerHTML = '';

    data.jobs.forEach(j => {
        const card = document.createElement('div');
        card.className = 'job-card';
        const skillTags = (j.jd_skills || []).map(s => `<span class="skill-tag">${s}</span>`).join('');
        card.innerHTML = `
            <div class="job-header">
                <span class="job-id">${j.job_id}</span>
                <h3>${j.title}</h3>
            </div>
            <div class="card-skills">${skillTags}</div>
            <div class="card-actions">
                <span class="candidate-exp">${j.candidates_matched} candidates matched</span>
                <span class="candidate-exp">${j.created_at ? new Date(j.created_at).toLocaleDateString() : ''}</span>
            </div>
        `;
        container.appendChild(card);
    });
}

// =========================
// Legacy Interview Functions
// =========================

// =========================
// Interview Invite — Added by Ishita
// =========================
let selectedInvitees = new Set();

async function searchForInvite() {
    const q = document.getElementById('inviteSearch').value.trim();
    if (!q) return alert("Enter a candidate name to search");

    let candidates = [];
    try {
        const res = await fetch(`/candidates/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        candidates = data.candidates || [];
    } catch {
        // Fallback: filter from cached candidates
        candidates = allCandidatesCache.filter(c =>
            c.name.toLowerCase().includes(q.toLowerCase()) ||
            c.candidate_id.toLowerCase().includes(q.toLowerCase())
        );
    }

    const container = document.getElementById('inviteResultsList');
    container.innerHTML = '';
    selectedInvitees.clear();
    document.getElementById('sendInviteBtn').disabled = true;
    document.getElementById('inviteSentResults').classList.add('hidden');

    if (!candidates || !candidates.length) {
        container.innerHTML = '<p class="empty-state">No candidates found.</p>';
        return;
    }

    candidates.forEach(c => {
        const row = document.createElement('div');
        row.className = 'invite-row';
        const skillTags = (c.candidate_skills || c.skills || []).slice(0, 5)
            .map(s => `<span class="skill-tag">${s}</span>`).join('');
        row.innerHTML = `
            <label class="invite-checkbox">
                <input type="checkbox" value="${c.candidate_id}" onchange="toggleInvitee(this)">
            </label>
            <div class="invite-info">
                <a href="/candidate?id=${c.candidate_id}" class="candidate-name-link">${c.name}</a>
                <span class="candidate-id">${c.candidate_id}</span>
                <span class="candidate-exp">${c.years_experience || 0} yrs exp</span>
            </div>
            <div class="invite-skills">${skillTags}</div>
        `;
        container.appendChild(row);
    });
}

function toggleInvitee(checkbox) {
    if (checkbox.checked) {
        selectedInvitees.add(checkbox.value);
    } else {
        selectedInvitees.delete(checkbox.value);
    }
    document.getElementById('sendInviteBtn').disabled = selectedInvitees.size === 0;
}

async function sendInvites() {
    if (selectedInvitees.size === 0) return;

    const btn = document.getElementById('sendInviteBtn');
    btn.textContent = '⏳ Sending invites...';
    btn.disabled = true;

    try {
        const resultsDiv = document.getElementById('inviteSentResults');
        resultsDiv.classList.remove('hidden');
        let inviteHtml = '<h3>✅ Invites Sent</h3>';

        for (const candidateId of selectedInvitees) {
            const candidate = allCandidatesCache.find(c => c.candidate_id === candidateId);
            const name = candidate ? candidate.name : candidateId;
            const email = candidate ? (candidate.email || '') : '';

            const res = await fetch('/send_email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name, email: email, id: candidateId })
            });
            const data = await res.json();

            if (data.interview_url) {
                inviteHtml += `
                    <div class="invite-sent-card">
                        <strong>${name}</strong> (${candidateId})<br>
                        <span class="invite-link">🔗 <a href="${data.interview_url}" target="_blank">${data.interview_url}</a></span>
                        ${data.email_error ? `<br><small style="color:#d97706">⚠️ Email failed: ${data.email_error}</small>` : ''}
                    </div>
                `;
            } else {
                inviteHtml += `
                    <div class="invite-sent-card" style="border-color: #fca5a5; background: #fef2f2;">
                        <strong>${name}</strong> (${candidateId}): ${data.error || 'Failed to send invite'}
                    </div>
                `;
            }
        }

        resultsDiv.innerHTML = inviteHtml;
        selectedInvitees.clear();
        document.querySelectorAll('#inviteResultsList input[type=checkbox]').forEach(cb => cb.checked = false);
    } catch (err) {
        alert('Error sending invites: ' + err.message);
    } finally {
        btn.textContent = '📩 Send Interview Invite';
        btn.disabled = true;
    }
}

// =========================
// Legacy Interview (original)
// =========================
function startLegacyInterview() {
    currentCandidate = document.getElementById("candidateNameInterview").value;
    if (!currentCandidate) return alert("Enter candidate name");
    ws = new WebSocket(`ws://${window.location.host}/ws/interview/${currentCandidate}`);
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.question) {
            document.getElementById("questionBox").textContent = `Skill: ${data.skill}\nQuestion: ${data.question}`;
        } else if (data.message) {
            alert(data.message);
        }
    };
}

async function sendAnswer() {
    const answer = document.getElementById("answerInput").value;
    if (!answer || !ws) return;
    ws.send(answer);
    document.getElementById("transcriptArea").textContent += `Answer: ${answer}\n\n`;
    document.getElementById("answerInput").value = "";
}

function startVoice() {
    if (!('webkitSpeechRecognition' in window)) return alert("Voice not supported");
    const recognition = new webkitSpeechRecognition();
    recognition.lang = 'en-US';
    recognition.onresult = function(event) {
        document.getElementById("answerInput").value = event.results[0][0].transcript;
    };
    recognition.start();
}

async function submitTranscript() {
    const candidate = document.getElementById("candidateSelectSubmitTranscript").value;
    if (!candidate) {
        alert("Please select a candidate");
        return;
    }
    const transcriptText = document.getElementById("manualTranscript").value.trim();
    if (!transcriptText) {
        alert("Please paste transcript");
        return;
    }
    try {
        const res = await fetch(`/submit_transcript/${candidate}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transcript: transcriptText })
        });
        const data = await res.json();
        document.getElementById("submitResult").textContent = JSON.stringify(data, null, 2);
    } catch (err) {
        console.error(err);
        document.getElementById("submitResult").textContent = "Error submitting transcript";
    }
}

// =========================
// Submit Transcript — Candidate Search/Filter
// =========================
function searchCandidateSubmitTranscript() {
    const searchText = document.getElementById("candidateSearchSubmitTranscript").value.toLowerCase();
    const filtered = allCandidatesCache.filter(c =>
        c.name.toLowerCase().includes(searchText) ||
        c.candidate_id.toLowerCase().includes(searchText)
    );
    populateDropdown("candidateSelectSubmitTranscript", filtered);
}

// =========================
// Compare Candidates
// =========================

// Populate candidate checkboxes in JD section after JD upload
function populateJDCandidateCheckboxes() {
    const container = document.getElementById('jdCandidateCheckboxes');
    if (!container) return;
    container.innerHTML = '';
    allCandidatesCache.forEach(c => {
        const label = document.createElement('label');
        label.className = 'jd-candidate-item';
        label.style.cssText = 'display:flex; align-items:center; gap:8px; padding:4px 0; cursor:pointer; font-size:0.9rem';
        label.innerHTML = `
            <input type="checkbox" class="jd-cand-cb" value="${c.candidate_id}">
            <span>${c.name}</span>
            <span style="color:#888; font-size:0.8rem">(${c.candidate_id})</span>
        `;
        container.appendChild(label);
    });
}

function filterJDCandidateList() {
    const q = (document.getElementById('jdCandidateFilter').value || '').toLowerCase();
    document.querySelectorAll('#jdCandidateCheckboxes .jd-candidate-item').forEach(label => {
        const text = label.textContent.toLowerCase();
        label.style.display = text.includes(q) ? '' : 'none';
    });
}

function toggleJDSelectAll(masterCb) {
    document.querySelectorAll('#jdCandidateCheckboxes .jd-cand-cb').forEach(cb => {
        if (cb.closest('.jd-candidate-item').style.display !== 'none') {
            cb.checked = masterCb.checked;
        }
    });
}

async function rankSelectedCandidates() {
    const jdFile = document.getElementById('jdFile').files[0];
    if (!jdFile) { alert('JD file is required. Please re-select it if needed.'); return; }

    const selected = Array.from(document.querySelectorAll('#jdCandidateCheckboxes .jd-cand-cb:checked')).map(cb => cb.value);
    if (selected.length === 0) { alert('Please select at least one candidate.'); return; }

    // Collapse the other panel and hide its results
    const analyzePanel = document.getElementById('analyzeAllPanel');
    if (analyzePanel) analyzePanel.removeAttribute('open');
    document.getElementById('matchResults')?.classList.add('hidden');

    const topN = parseInt(document.getElementById('jdTopN').value) || 5;

    document.getElementById('rankLoading').classList.remove('hidden');
    document.getElementById('rankResults').classList.add('hidden');

    try {
        const formData = new FormData();
        formData.append('jd_file', jdFile);
        formData.append('candidate_ids', JSON.stringify(selected));
        formData.append('top_n', topN);

        const res = await fetch('/rank_candidates', { method: 'POST', body: formData });
        const data = await res.json();

        document.getElementById('rankLoading').classList.add('hidden');

        if (data.error) {
            alert('Error: ' + data.error);
            return;
        }

        renderRankResults(data.top_candidates || [], data.jd_skills || []);
        document.getElementById('rankResults').classList.remove('hidden');
    } catch (err) {
        document.getElementById('rankLoading').classList.add('hidden');
        alert('Error ranking candidates: ' + err.message);
    }
}

function renderRankResults(candidates, jdSkills) {
    const container = document.getElementById('rankResultsList');
    container.innerHTML = '';

    if (!candidates.length) {
        container.innerHTML = '<p class="empty-state">No matching candidates found.</p>';
        return;
    }

    candidates.forEach((c, i) => {
        const card = document.createElement('div');
        card.className = 'candidate-card match-card';

        const score = c.match_score || 0;
        const matchClass = score >= 70 ? 'match-high' : score >= 40 ? 'match-mid' : 'match-low';

        const skillTags = (c.skills || []).map(s => {
            const isMatch = jdSkills.some(j => j.toLowerCase() === s.toLowerCase());
            return `<span class="skill-tag ${isMatch ? 'skill-match' : ''}">${isMatch ? '✅ ' : ''}${s}</span>`;
        }).join('');

        card.innerHTML = `
            <div class="card-header">
                <div class="card-rank">#${i + 1}</div>
                <div class="card-info">
                    <span class="candidate-id">${c.candidate_id}</span>
                    <h3 class="candidate-name">${c.candidate || c.name || ''}</h3>
                </div>
                <div class="match-score ${matchClass}">${score}%</div>
            </div>
            <div class="card-skills">${skillTags}</div>
            <div class="card-actions">
                <a href="/candidate?id=${c.candidate_id}" class="btn-link">View Candidate →</a>
            </div>
        `;
        container.appendChild(card);
    });
}

async function compareCandidates() {
    const jdFile = document.getElementById("compareJD").files[0];
    const resumes = document.getElementById("compareResumes").files;
    const topN = document.getElementById("topN").value;
    if (!jdFile || resumes.length === 0) {
        alert("Please upload JD and resumes");
        return;
    }
    try {
        const resumeForm = new FormData();
        for (let r of resumes) resumeForm.append("files", r);
        const uploadRes = await fetch("/upload_resumes", { method: "POST", body: resumeForm });
        const uploadData = await uploadRes.json();
        const candidateIds = uploadData.candidates.map(c => c.candidate_id);

        const formData = new FormData();
        formData.append("jd_file", jdFile);
        formData.append("candidate_ids", JSON.stringify(candidateIds));
        formData.append("top_n", topN);

        const res = await fetch("/rank_candidates", { method: "POST", body: formData });
        const data = await res.json();
        const resultBox = document.getElementById("rankingResult");
        if (data.error) {
            resultBox.textContent = "Error: " + data.error;
            return;
        }
        resultBox.textContent = JSON.stringify(data, null, 2);
    } catch (err) {
        console.error(err);
        document.getElementById("rankingResult").textContent = "Error running candidate comparison";
    }
}

// =========================
// Knowledge Base
// =========================
async function uploadKnowledge() {
    const file = document.getElementById("knowledgeFile").files[0];
    if (!file) return alert("Select knowledge file");
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/upload_knowledge", { method: "POST", body: formData });
    const data = await res.json();
    document.getElementById("knowledgeResult").textContent = JSON.stringify(data, null, 2);
}

async function listKnowledge() {
    const res = await fetch("/knowledge_files");
    const data = await res.json();
    document.getElementById("knowledgeResult").textContent = JSON.stringify(data, null, 2);
}

// =========================
// Reports & Analytics
// =========================
function searchCandidateForReport() {
    const searchText = document.getElementById("candidateSearchReport").value.toLowerCase();
    const filtered = allCandidatesCache.filter(c =>
        c.name.toLowerCase().includes(searchText) ||
        c.candidate_id.toLowerCase().includes(searchText)
    );
    populateDropdown("candidateSelectReport", filtered);
}

let skillRadarChart, scoreTrendChart, comparisonChart, skillChart, strengthWeaknessChart, categoryChart;

async function getReport() {
    const candidate = document.getElementById("candidateSelectReport").value;
    if (!candidate) { alert("Please select candidate"); return; }
    const resultBox = document.getElementById("reportResult");
    resultBox.textContent = "Generating report...";
    try {
        const res = await fetch(`/interview_report/${candidate}`);
        const data = await res.json();
        resultBox.textContent = JSON.stringify(data, null, 2);
        if (data.skill_scores) renderSkillRadar(data.skill_scores);
        if (data.transcript) renderScoreTrend(data.transcript);
        if (data.skill_scores) renderSkillScoreChart(data.skill_scores);
        if (data.transcript) renderStrengthWeaknessChart(data.transcript);
        if (data.category_scores) renderSkillCategoryChart(data.category_scores);
    } catch (err) {
        console.error(err);
        resultBox.textContent = "Error generating report";
    }
}

async function getAnalytics() {
    const res = await fetch("/candidate_comparison");
    const data = await res.json();
    document.getElementById("analyticsResult").textContent = JSON.stringify(data, null, 2);
    if (data.candidates) renderCandidateComparison(data.candidates);
}

// =========================
// Chart Rendering
// =========================
function renderSkillRadar(skillScores) {
    const skills = Object.keys(skillScores);
    const scores = Object.values(skillScores);
    const ctx = document.getElementById("skillRadarChart");
    if (skillRadarChart) skillRadarChart.destroy();
    skillRadarChart = new Chart(ctx, {
        type: "radar",
        data: { labels: skills, datasets: [{ label: "Skill Score", data: scores }] },
        options: { scales: { r: { suggestedMin: 0, suggestedMax: 10 } } }
    });
}

function renderScoreTrend(transcript) {
    const labels = [];
    const scores = [];
    transcript.forEach((q, i) => {
        labels.push("Q" + (i + 1));
        scores.push(q.evaluation?.score || 0);
    });
    const ctx = document.getElementById("scoreTrendChart");
    if (scoreTrendChart) scoreTrendChart.destroy();
    scoreTrendChart = new Chart(ctx, {
        type: "line",
        data: { labels: labels, datasets: [{ label: "Answer Score", data: scores, tension: 0.3 }] }
    });
}

function renderCandidateComparison(candidates) {
    const names = candidates.map(c => c.name);
    const scores = candidates.map(c => c.score);
    const ctx = document.getElementById("comparisonChart");
    if (comparisonChart) comparisonChart.destroy();
    comparisonChart = new Chart(ctx, {
        type: "bar",
        data: { labels: names, datasets: [{ label: "Overall Score", data: scores }] }
    });
}

function renderSkillScoreChart(skillScores) {
    const labels = Object.keys(skillScores);
    const data = Object.values(skillScores);
    const ctx = document.getElementById("skillScoreChart");
    if (skillChart) skillChart.destroy();
    skillChart = new Chart(ctx, {
        type: "bar",
        data: { labels: labels, datasets: [{ label: "Skill Score", data: data }] },
        options: { responsive: true, scales: { y: { min: 0, max: 10 } } }
    });
}

function renderStrengthWeaknessChart(transcript) {
    const strengths = {};
    const weaknesses = {};
    transcript.forEach(q => {
        (q.evaluation?.strengths || []).forEach(s => { strengths[s] = (strengths[s] || 0) + 1; });
        (q.evaluation?.weaknesses || []).forEach(w => { weaknesses[w] = (weaknesses[w] || 0) + 1; });
    });
    const labels = [...new Set([...Object.keys(strengths), ...Object.keys(weaknesses)])];
    const strengthCounts = labels.map(l => strengths[l] || 0);
    const weaknessCounts = labels.map(l => weaknesses[l] || 0);
    const ctx = document.getElementById("strengthWeaknessChart");
    if (strengthWeaknessChart) strengthWeaknessChart.destroy();
    strengthWeaknessChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels: labels,
            datasets: [
                { label: "Strengths", data: strengthCounts, stack: "analysis" },
                { label: "Weaknesses", data: weaknessCounts, stack: "analysis" }
            ]
        },
        options: { responsive: true, scales: { x: { stacked: true }, y: { stacked: true } } }
    });
}

function renderSkillCategoryChart(categoryScores) {
    if (!categoryScores) return;
    const labels = Object.keys(categoryScores);
    const data = Object.values(categoryScores);
    const ctx = document.getElementById("skillCategoryChart");
    if (categoryChart) categoryChart.destroy();
    categoryChart = new Chart(ctx, {
        type: "bar",
        data: { labels: labels, datasets: [{ label: "Category Score", data: data }] },
        options: { responsive: true, scales: { y: { min: 0, max: 10 } } }
    });
}