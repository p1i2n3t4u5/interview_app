// =========================
// Added by Ishita — Candidate Detail Page JS
// Loads candidate by ID from URL, renders profile, job matches, interview transcript, report
// =========================

const params = new URLSearchParams(window.location.search);
const candidateId = params.get('id');
let candidateData = null;

// Load candidate on page load
if (candidateId) {
    loadCandidate();
} else {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('errorState').classList.remove('hidden');
    document.getElementById('errorState').textContent = 'No candidate ID provided. Use ?id=XXXX-yyyy in the URL.';
}

async function loadCandidate() {
    try {
        const res = await fetch(`/recruiter/candidate/${encodeURIComponent(candidateId)}`);
        const data = await res.json();

        if (data.error) {
            document.getElementById('loading').classList.add('hidden');
            document.getElementById('errorState').classList.remove('hidden');
            return;
        }

        candidateData = data;
        renderCandidate(data);
    } catch (err) {
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('errorState').classList.remove('hidden');
        document.getElementById('errorState').textContent = 'Error loading candidate: ' + err.message;
    }
}

function renderCandidate(data) {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('candidateHeader').classList.remove('hidden');
    document.getElementById('tabsContainer').classList.remove('hidden');

    // Header
    document.getElementById('detailId').textContent = data.candidate_id;
    document.getElementById('detailName').textContent = data.name;
    document.getElementById('detailExp').textContent = `${data.years_experience || 0} years experience`;
    document.title = `${data.name} — AI Interview Platform`;

    const statusEl = document.getElementById('detailStatus');
    statusEl.textContent = data.status;
    statusEl.className = `status-pill status-${data.status}`;

    document.getElementById('detailSummary').textContent = data.ai_summary || 'AI summary not available.';

    // Skills
    const skillsEl = document.getElementById('detailSkills');
    skillsEl.innerHTML = (data.candidate_skills || [])
        .map(s => `<span class="skill-tag">${s}</span>`)
        .join('');

    // Resume
    document.getElementById('detailResume').textContent = data.resume || 'No resume text available.';

    // Job Matches
    renderJobMatches(data.job_matches || []);

    // Interview
    renderInterview(data.transcript || [], data.skill_scores || {});
}

// =========================
// Tab Switching
// =========================
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
}

// =========================
// Job Matches
// =========================
function renderJobMatches(matches) {
    const container = document.getElementById('matchesContent');

    if (!matches.length) {
        container.innerHTML = '<p class="empty-state">No job matches yet. Run a job match from the Dashboard.</p>';
        return;
    }

    let html = '<table class="match-table"><thead><tr><th>Job</th><th>Match %</th><th>Matched Skills</th><th>Missing Skills</th><th>AI Assessment</th></tr></thead><tbody>';

    matches.forEach(m => {
        const matchClass = m.match_percent >= 70 ? 'match-high' : m.match_percent >= 40 ? 'match-mid' : 'match-low';
        const matched = (m.matched_skills || []).map(s => `<span class="skill-tag skill-match">${s}</span>`).join(' ');
        const missing = (m.missing_skills || []).map(s => `<span class="skill-tag skill-miss">${s}</span>`).join(' ');

        html += `<tr>
            <td><strong>${m.job_title || m.job_id}</strong><br><span class="candidate-id">${m.job_id}</span></td>
            <td><span class="match-score ${matchClass}" style="font-size:1.1rem">${m.match_percent}%</span></td>
            <td>${matched || '-'}</td>
            <td>${missing || '-'}</td>
            <td style="font-size:0.8rem; color:#475569; max-width:250px;">${m.ai_summary || '-'}</td>
        </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

// =========================
// Interview Transcript
// =========================
function renderInterview(transcript, skillScores) {
    const container = document.getElementById('interviewContent');

    if (!transcript.length) {
        container.innerHTML = `
            <p class="empty-state">No interview conducted yet.</p>
            <div style="text-align:center; margin-top:12px;">
                <a href="/" class="btn-primary" style="text-decoration:none; display:inline-block;">Go to Dashboard to Start Interview</a>
            </div>`;
        return;
    }

    // Skill score bars
    let html = '<h3>Skill Scores</h3>';
    const scores = Object.entries(skillScores);
    if (scores.length) {
        scores.forEach(([skill, score]) => {
            const pct = Math.min(score * 10, 100);
            const cls = score >= 7 ? 'high' : score >= 4 ? 'mid' : 'low';
            html += `
                <div class="skill-bar-container">
                    <div class="skill-bar-label">
                        <span>${skill}</span>
                        <span>${score}/10</span>
                    </div>
                    <div class="skill-bar">
                        <div class="skill-bar-fill ${cls}" style="width: ${pct}%"></div>
                    </div>
                </div>`;
        });
    }

    // Q&A Cards
    html += '<h3 style="margin-top: 24px;">Questions & Answers</h3>';
    transcript.forEach((item, i) => {
        const score = item.evaluation?.score || 0;
        const scoreClass = score >= 7 ? 'score-high' : score >= 4 ? 'score-mid' : 'score-low';

        html += `
            <div class="qa-card">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div class="qa-skill">${item.skill || 'General'} — Q${i + 1}</div>
                    <span class="qa-score ${scoreClass}">${score}/10</span>
                </div>
                <div class="qa-question">${item.question || ''}</div>
                <div class="qa-answer">${item.answer || 'No answer'}</div>
                ${item.evaluation?.feedback ? `<div style="font-size:0.8rem; color:#64748b; margin-top:6px;">💡 ${item.evaluation.feedback}</div>` : ''}
            </div>`;
    });

    container.innerHTML = html;
}

// =========================
// Report
// =========================
async function loadReport() {
    if (!candidateData) return;

    const name = candidateData.name;
    const btn = event.target;
    btn.textContent = '⏳ Generating with AI...';
    btn.disabled = true;

    try {
        const res = await fetch(`/interview_report/${encodeURIComponent(name)}`);
        const data = await res.json();
        renderReport(data);
    } catch (err) {
        document.getElementById('reportData').innerHTML = `<p style="color:red;">Error: ${err.message}</p>`;
    } finally {
        btn.textContent = 'Generate Interview Report';
        btn.disabled = false;
    }
}

function renderReport(data) {
    const container = document.getElementById('reportData');

    if (!data.report || !data.skill_scores) {
        container.innerHTML = '<p class="empty-state">No interview data available for report generation.</p>';
        return;
    }

    const report = data.report;
    const overallScore = report.overall_score || 0;
    const scoreClass = overallScore >= 7 ? 'score-high' : overallScore >= 4 ? 'score-mid' : 'score-low';

    const rec = (report.recommendation || '').toLowerCase();
    const recClass = rec.includes('hire') && !rec.includes('no') ? 'rec-hire' :
                     rec.includes('no') ? 'rec-no-hire' : 'rec-borderline';

    let html = `
        <div class="report-card" style="margin-top: 16px;">
            <h3>Overall Assessment</h3>
            <div class="report-score ${scoreClass}">${overallScore}/10</div>
            <div class="report-recommendation ${recClass}">${report.recommendation || 'N/A'}</div>
            <div class="report-lists">
                <div class="report-list strengths">
                    <h4>Strengths</h4>
                    <ul>${(report.strengths || []).map(s => `<li>${s}</li>`).join('')}</ul>
                </div>
                <div class="report-list weaknesses">
                    <h4>Areas for Improvement</h4>
                    <ul>${(report.weaknesses || []).map(w => `<li>${w}</li>`).join('')}</ul>
                </div>
            </div>
        </div>`;

    // Skill breakdown
    const scores = Object.entries(data.skill_scores || {});
    if (scores.length) {
        html += '<h3 style="margin-top: 24px;">Skill Breakdown</h3>';
        scores.forEach(([skill, score]) => {
            const pct = Math.min(score * 10, 100);
            const cls = score >= 7 ? 'high' : score >= 4 ? 'mid' : 'low';
            html += `
                <div class="skill-bar-container">
                    <div class="skill-bar-label"><span>${skill}</span><span>${score}/10</span></div>
                    <div class="skill-bar"><div class="skill-bar-fill ${cls}" style="width: ${pct}%"></div></div>
                </div>`;
        });
    }

    container.innerHTML = html;
}

// =========================
// Send Interview Invite from Detail Page — Added by Ishita
// =========================
async function sendInviteFromDetail() {
    if (!candidateData) return;

    const btn = document.getElementById('detailInviteBtn');
    btn.textContent = '⏳ Sending...';
    btn.disabled = true;

    try {
        const res = await fetch('/send_email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: candidateData.name,
                email: candidateData.email || '',
                id: candidateData.candidate_id
            })
        });
        const data = await res.json();

        if (data.interview_url) {
            const resultDiv = document.getElementById('detailInviteResult');
            resultDiv.classList.remove('hidden');
            resultDiv.innerHTML = `✅ Invite sent! <a href="${data.interview_url}" target="_blank">${data.interview_url}</a>`;

            if (data.email_error) {
                resultDiv.innerHTML += `<br><small style="color:#d97706">⚠️ Email delivery failed: ${data.email_error}</small>`;
            }

            // Update status pill
            const statusEl = document.getElementById('detailStatus');
            statusEl.textContent = 'invited';
            statusEl.className = 'status-pill status-invited';
        } else {
            alert(data.error || 'Failed to send invite');
        }
    } catch (err) {
        alert('Error sending invite: ' + err.message);
    } finally {
        btn.textContent = '📩 Send Interview Invite';
        btn.disabled = false;
    }
}
