/* ---- START: Ishita - Candidate profile JS: load profile, render progress/stats/skills/interview analysis/charts/transcript/work experience ---- */
/* ===================================================
   Candidate Profile Page — JavaScript
   =================================================== */

let candidateData = null;
let chartInstances = {};

/* ---------- Init ---------- */
document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (!id) {
        showError();
        return;
    }
    await loadCandidateProfile(id);
});

async function loadCandidateProfile(candidateId) {
    try {
        const data = await apiGet(`/recruiter/candidate/${encodeURIComponent(candidateId)}`);
        if (data.error) {
            showError();
            return;
        }
        candidateData = data;
        renderProfile();
    } catch {
        showError();
    }
}

function showError() {
    hide('#loadingState');
    show('#errorState');
}

/* ---------- Render Profile ---------- */
function renderProfile() {
    hide('#loadingState');
    show('#profileContent');

    const c = candidateData;

    // Avatar
    document.getElementById('profileAvatar').textContent = getInitials(c.name);

    // Name & meta
    setText('#profileName', c.name);
    document.getElementById('profileMeta').innerHTML = [
        c.email ? `📧 ${c.email}` : '',
        c.phone ? `📱 ${c.phone}` : '',
        c.location ? `📍 ${c.location}` : '',
        c.linkedin ? `<a href="${c.linkedin}" target="_blank">LinkedIn</a>` : '',
        c.github ? `<a href="${c.github}" target="_blank">GitHub</a>` : ''
    ].filter(Boolean).join(' &nbsp;•&nbsp; ');

    document.getElementById('profileKey').textContent = `🔑 ${c.id}`;

    // Score badge
    const score = c.interview_average_score || 0;
    const scoreColor = score >= 7 ? 'var(--accent)' : score >= 4 ? 'var(--warning)' : 'var(--danger)';
    setHTML('#profileScoreBadge', score > 0
        ? `<div class="overall-score-ring" style="border-color:${scoreColor}; color:${scoreColor}">${score}</div><div class="text-sm text-muted mt-4">Avg Score</div>`
        : '<span class="badge badge-neutral">Not Interviewed</span>'
    );

    renderProgress(c);
    renderQuickStats(c);
    renderJDMatch(c);
    renderSkills(c);
    renderInterviewAnalysis(c);
    renderOverallFeedback(c);
    renderProctoring(c);
    renderWorkExperience(c);
    renderEducation(c);

    // Disable invite button if interview is completed
    const inviteBtn = document.getElementById('sendInviteBtn');
    if (inviteBtn && c.interview_status === 'completed') {
        inviteBtn.disabled = true;
        inviteBtn.textContent = '✅ Interview Completed';
        inviteBtn.style.opacity = '0.6';
        inviteBtn.style.cursor = 'not-allowed';
    }
}

/* ---------- Progress Stepper ---------- */
function renderProgress(c) {
    const stages = ['Resume Uploaded', 'Skills Extracted', 'JD Analyzed', 'Interview Scheduled', 'Interview Completed'];
    let current = 0;
    if (c.candidate_skills?.length > 0) current = 1;
    if (c.jd_skills?.length > 0) current = 2;
    if (c.interview_status === 'pending' || c.interview_status === 'active') current = 3;
    if (c.interview_status === 'completed') current = 5;

    setHTML('#progressStepper', renderProgressStepper(stages, current));
}

/* ---------- Quick Stats ---------- */
function getInterviewSource(c) {
    const ai = c.ai_interview_transcript || [];
    const manual = c.transcript || [];
    if (ai.length > 0) return { label: 'Live AI Interview', icon: '🤖', color: 'var(--primary)' };
    if (manual.length > 0) return { label: 'Uploaded Transcript', icon: '📤', color: 'var(--warning, #d97706)' };
    return { label: 'Not Interviewed', icon: '—', color: 'var(--text-muted)' };
}

function renderQuickStats(c) {
    const skills = c.candidate_skills || [];
    const jdSkills = c.jd_skills || [];
    const transcript = c.ai_interview_transcript || c.transcript || [];
    const matched = skills.filter(s => jdSkills.some(j => j.toLowerCase() === s.toLowerCase()));
    const source = getInterviewSource(c);

    setHTML('#quickStats', `
        <div class="stat-card"><div class="stat-value">${skills.length}</div><div class="stat-label">Skills Found</div></div>
        <div class="stat-card"><div class="stat-value">${c.years_experience || '—'}</div><div class="stat-label">Years Experience</div></div>
        <div class="stat-card"><div class="stat-value">${matched.length}/${jdSkills.length || '—'}</div><div class="stat-label">JD Skills Matched</div></div>
        <div class="stat-card"><div class="stat-value">${transcript.length}</div><div class="stat-label">Interview Questions</div></div>
        <div class="stat-card"><div class="stat-value" style="font-size:16px; color:${source.color}">${source.icon} ${source.label}</div><div class="stat-label">Interview Source</div></div>
    `);
}

/* ---------- JD Match Section ---------- */
function renderJDMatch(c) {
    const container = document.getElementById('jdMatchSection');
    const jobMatches = c.job_matches || [];
    const hasLegacyJD = c.jd && c.jd_skills?.length;

    if (!jobMatches.length && !hasLegacyJD) {
        container.innerHTML = '<p class="text-muted">No JD uploaded for this candidate yet.</p>';
        return;
    }

    let html = '';

    // Render each job match
    if (jobMatches.length > 0) {
        jobMatches.forEach(match => {
            const matchPct = match.match_percent || 0;
            const matched = match.matched_skills || [];
            const missing = match.missing_skills || [];
            html += `
            <div class="jd-match-card" style="margin-bottom:16px">
                <h4>${match.title || 'Job'} <span class="text-muted text-sm">(${match.job_id || ''})</span></h4>
                ${match.ai_summary ? `<p class="text-sm text-muted" style="margin-bottom:8px">${match.ai_summary}</p>` : ''}
                ${renderGapBar('Overall Match', matchPct)}
                <div class="gap-summary" style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:12px">
                    <div>
                        <h4 style="font-size:12px; color:var(--text-muted); text-transform:uppercase">✅ Matched (${matched.length})</h4>
                        <div class="skill-tags">${matched.map(s => `<span class="skill-tag matched">${s}</span>`).join('') || '<span class="text-muted text-sm">None</span>'}</div>
                    </div>
                    <div>
                        <h4 style="font-size:12px; color:var(--text-muted); text-transform:uppercase">❌ Missing (${missing.length})</h4>
                        <div class="skill-tags">${missing.map(s => `<span class="skill-tag missing">${s}</span>`).join('') || '<span class="text-muted text-sm">None</span>'}</div>
                    </div>
                </div>
            </div>`;
        });
    } else if (hasLegacyJD) {
        // Fallback to legacy single JD match — use fuzzy matching
        const cSkills = (c.candidate_skills || []).map(s => s.toLowerCase());
        const jSkills = c.jd_skills || [];

        function fuzzyMatch(jdSkill) {
            const js = jdSkill.toLowerCase();
            return cSkills.some(cs =>
                cs === js || cs.includes(js) || js.includes(cs) ||
                cs.replace(/[\s.\-]?\d+(\.\d+)*$/, '').trim() === js.replace(/[\s.\-]?\d+(\.\d+)*$/, '').trim()
            );
        }

        const matched = jSkills.filter(s => fuzzyMatch(s));
        const missing = jSkills.filter(s => !fuzzyMatch(s));
        const matchPct = jSkills.length ? Math.round(matched.length / jSkills.length * 100) : 0;

        html += `
        <div class="jd-match-card">
            <h4>Job Description Match</h4>
            ${renderGapBar('Overall Match', matchPct)}
            <div class="gap-summary" style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:12px">
                <div>
                    <h4 style="font-size:12px; color:var(--text-muted); text-transform:uppercase">✅ Matched (${matched.length})</h4>
                    <div class="skill-tags">${matched.map(s => `<span class="skill-tag matched">${s}</span>`).join('') || '<span class="text-muted text-sm">None</span>'}</div>
                </div>
                <div>
                    <h4 style="font-size:12px; color:var(--text-muted); text-transform:uppercase">❌ Missing (${missing.length})</h4>
                    <div class="skill-tags">${missing.map(s => `<span class="skill-tag missing">${s}</span>`).join('') || '<span class="text-muted text-sm">None</span>'}</div>
                </div>
            </div>
        </div>`;

        html += `<details class="mt-4">
            <summary class="text-sm fw-600" style="cursor:pointer">View Job Description Text</summary>
            <pre class="result-box mt-4" style="max-height:200px">${escapeHtml(truncate(c.jd, 2000))}</pre>
        </details>`;
    }

    container.innerHTML = html;
}

/* ---------- Skills Overview ---------- */
function renderSkills(c) {
    const skills = c.candidate_skills || [];
    const jdSkillsList = (c.jd_skills || []).map(s => s.toLowerCase());

    function isJDMatch(skill) {
        const s = skill.toLowerCase();
        return jdSkillsList.some(js =>
            s === js || s.includes(js) || js.includes(s) ||
            s.replace(/[\s.\-]?\d+(\.\d+)*$/, '').trim() === js.replace(/[\s.\-]?\d+(\.\d+)*$/, '').trim()
        );
    }

    setHTML('#skillsOverview', `
        <div class="skill-tags">
            ${skills.map(s => {
                return `<span class="skill-tag ${isJDMatch(s) ? 'matched' : ''}">${s}</span>`;
            }).join('')}
        </div>
        ${skills.length === 0 ? '<p class="text-muted">No skills extracted yet.</p>' : ''}
    `);
}

/* ---------- AI Interview Analysis ---------- */

// Normalize transcript item fields (AI interview uses analysis/skill_area, manual uses evaluation/skill)
function normalizeTranscriptItem(item) {
    return {
        question: item.question || '',
        answer: item.answer || '',
        skill_area: item.skill_area || item.skill || 'General',
        difficulty: item.difficulty || '',
        score: item.analysis?.score ?? item.evaluation?.score ?? undefined,
        strengths: item.analysis?.strengths || item.evaluation?.strengths || [],
        weaknesses: item.analysis?.weaknesses || item.evaluation?.weaknesses || [],
        feedback: item.analysis?.feedback || item.evaluation?.feedback || '',
    };
}

function renderInterviewAnalysis(c) {
    // Merge both AI interview transcript and manual transcript
    const aiTranscript = c.ai_interview_transcript || [];
    const manualTranscript = c.transcript || [];
    const rawTranscript = aiTranscript.length > 0 ? aiTranscript : manualTranscript;
    const transcript = rawTranscript.map(normalizeTranscriptItem);
    const container = document.getElementById('interviewAnalysis');

    if (transcript.length === 0) {
        container.innerHTML = '<p class="text-muted">No interview data available. Interview has not been conducted yet.</p>';
        hide('#chartSection');
        return;
    }

    const source = getInterviewSource(c);
    const sourceBadge = `<span style="display:inline-block; padding:3px 10px; border-radius:50px; font-size:12px; font-weight:600; background:${source.color}18; color:${source.color}; margin-left:10px">${source.icon} ${source.label}</span>`;

    // Compute skill scores from transcript
    const skillScores = {};
    const scores = [];
    transcript.forEach(item => {
        if (item.score !== undefined && item.score > 0) {
            const skill = item.skill_area;
            if (!skillScores[skill]) skillScores[skill] = [];
            skillScores[skill].push(item.score);
            scores.push(item.score);
        }
    });

    const avgScores = {};
    Object.entries(skillScores).forEach(([k, v]) => {
        avgScores[k] = Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10;
    });

    const overallAvg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '—';

    // Summary
    let strengths = [];
    let weaknesses = [];
    transcript.forEach(item => {
        item.strengths.forEach(s => strengths.push(s));
        item.weaknesses.forEach(w => weaknesses.push(w));
    });

    // Deduplicate
    strengths = [...new Set(strengths)].slice(0, 8);
    weaknesses = [...new Set(weaknesses)].slice(0, 8);

    container.innerHTML = `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value" style="color:${getScoreColor(overallAvg * 10)}">${overallAvg}/10</div>
                <div class="stat-label">Overall Score</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${transcript.length}</div>
                <div class="stat-label">Questions Asked</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${Object.keys(avgScores).length}</div>
                <div class="stat-label">Skill Areas Covered</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${c.interview_status || '—'}</div>
                <div class="stat-label">Status</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" style="font-size:14px; color:${source.color}">${source.icon} ${source.label}</div>
                <div class="stat-label">Interview Source</div>
            </div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:16px">
            <div>
                <h4 style="font-size:13px; color:var(--accent-dark); margin-bottom:8px">💪 Key Strengths</h4>
                ${strengths.map(s => `<div class="text-sm" style="padding:3px 0">• ${s}</div>`).join('') || '<span class="text-muted text-sm">None identified</span>'}
            </div>
            <div>
                <h4 style="font-size:13px; color:var(--danger); margin-bottom:8px">⚠️ Areas for Improvement</h4>
                ${weaknesses.map(w => `<div class="text-sm" style="padding:3px 0">• ${w}</div>`).join('') || '<span class="text-muted text-sm">None identified</span>'}
            </div>
        </div>
    `;

    // Charts
    show('#chartSection');
    if (Object.keys(avgScores).length > 0) {
        renderCChart('cSkillRadar', 'radar', Object.keys(avgScores), Object.values(avgScores), 'Skill Score');
        renderCChart('cSkillScores', 'bar', Object.keys(avgScores), Object.values(avgScores), 'Skill Score');
    }

    const trendLabels = [];
    const trendData = [];
    transcript.forEach((item, i) => {
        if (item.score !== undefined) {
            trendLabels.push('Q' + (i + 1));
            trendData.push(item.score);
        }
    });
    if (trendLabels.length > 0) {
        renderCChart('cScoreTrend', 'line', trendLabels, trendData, 'Score');
    }

    // Strengths vs Weakness chart
    const sMap = {};
    const wMap = {};
    transcript.forEach(item => {
        item.strengths.forEach(s => sMap[s] = (sMap[s] || 0) + 1);
        item.weaknesses.forEach(w => wMap[w] = (wMap[w] || 0) + 1);
    });
    const allLabels = [...new Set([...Object.keys(sMap), ...Object.keys(wMap)])].slice(0, 10);
    if (allLabels.length > 0) {
        const ctx = document.getElementById('cStrengthWeakness');
        if (chartInstances['cStrengthWeakness']) chartInstances['cStrengthWeakness'].destroy();
        chartInstances['cStrengthWeakness'] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: allLabels,
                datasets: [
                    { label: 'Strengths', data: allLabels.map(l => sMap[l] || 0), backgroundColor: 'rgba(16,185,129,0.7)' },
                    { label: 'Weaknesses', data: allLabels.map(l => wMap[l] || 0), backgroundColor: 'rgba(239,68,68,0.7)' }
                ]
            },
            options: { responsive: true, scales: { x: { stacked: true }, y: { stacked: true } } }
        });
    }

    // Render transcript items
    renderTranscriptItems(transcript);
}

function renderTranscriptItems(transcript) {
    const container = document.getElementById('transcriptSection');

    container.innerHTML = transcript.map((item, i) => {
        const score = item.score;
        const scoreClass = score >= 7 ? 'high-score' : score <= 3 ? 'low-score' : '';
        const scoreColor = score >= 7 ? 'var(--accent)' : score >= 4 ? 'var(--warning)' : 'var(--danger)';

        return `
        <div class="transcript-item ${scoreClass}">
            <div class="transcript-q">Q${i + 1} (${item.skill_area}): ${item.question}</div>
            <div class="transcript-a">${truncate(item.answer, 500)}</div>
            <div class="transcript-meta">
                ${score !== undefined ? `<span class="score-pill" style="background:${scoreColor}20; color:${scoreColor}">Score: ${score}/10</span>` : ''}
                <span>${item.difficulty || ''}</span>
                <span>${item.feedback || ''}</span>
            </div>
        </div>`;
    }).join('');
}

function toggleTranscript() {
    const section = document.getElementById('transcriptSection');
    if (section.classList.contains('hidden')) show('#transcriptSection');
    else hide('#transcriptSection');
}

/* ---------- Upload Transcript ---------- */
function toggleUploadTranscript() {
    const form = document.getElementById('uploadTranscriptForm');
    if (form.classList.contains('hidden')) show('#uploadTranscriptForm');
    else hide('#uploadTranscriptForm');
}

function handleTranscriptFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('transcriptText').value = e.target.result;
    };
    reader.readAsText(file);
}

async function submitTranscript() {
    if (!candidateData) return;
    const candidateId = candidateData.id || candidateData.candidate_id;
    if (!candidateId) { alert('No candidate ID found.'); return; }

    const text = document.getElementById('transcriptText').value.trim();
    if (!text) { alert('Please paste or upload a transcript first.'); return; }

    show('#transcriptUploadLoading');
    setHTML('#transcriptUploadResult', '');

    try {
        const data = await apiPost(`/submit_transcript/${encodeURIComponent(candidateId)}`, { transcript: text });
        hide('#transcriptUploadLoading');

        if (data.error) {
            setHTML('#transcriptUploadResult', `<p style="color:var(--danger)">${data.error}</p>`);
            return;
        }

        setHTML('#transcriptUploadResult', `
            <div style="padding:12px; background:var(--accent-bg, #f0f9ff); border-radius:8px; border:1px solid var(--accent, #2563eb)">
                <strong>✅ Transcript uploaded successfully!</strong><br>
                <span class="text-sm text-muted">${data.questions_added || 0} questions added • ${data.total_questions || 0} total questions</span>
            </div>
        `);

        // Clear the form
        document.getElementById('transcriptText').value = '';
        document.getElementById('transcriptFile').value = '';

        // Reload candidate profile to reflect new transcript
        await loadCandidateProfile(candidateId);
    } catch (err) {
        hide('#transcriptUploadLoading');
        setHTML('#transcriptUploadResult', `<p style="color:var(--danger)">Upload failed: ${err.message}</p>`);
    }
}

/* ---------- Send Interview Invite ---------- */
async function sendInterviewInvite() {
    if (!candidateData) return;
    const candidateId = candidateData.id || candidateData.candidate_id;
    const name = candidateData.name || '';
    const email = candidateData.email || '';

    if (!email) {
        setHTML('#inviteResult', `<div style="padding:12px; background:#fef2f2; border:1px solid #fca5a5; border-radius:8px; color:var(--danger)">⚠️ No email found for this candidate. Cannot send invite.</div>`);
        show('#inviteResult');
        return;
    }

    const btn = document.getElementById('sendInviteBtn');
    btn.textContent = '⏳ Sending...';
    btn.disabled = true;

    try {
        const data = await apiPost('/send_email', { name, email, id: candidateId });

        if (data.error) {
            setHTML('#inviteResult', `<div style="padding:12px; background:#fef2f2; border:1px solid #fca5a5; border-radius:8px; color:var(--danger)">❌ ${data.error}</div>`);
        } else {
            let html = `<div style="padding:12px; background:var(--accent-bg, #f0f9ff); border:1px solid var(--accent, #2563eb); border-radius:8px">
                <strong>✅ Interview invite sent!</strong><br>
                <span class="text-sm text-muted">🔗 <a href="${data.interview_url}" target="_blank">${data.interview_url}</a></span>`;
            if (data.email_error) {
                html += `<br><small style="color:#d97706">⚠️ Email delivery failed: ${data.email_error}</small>`;
            }
            html += `</div>`;
            setHTML('#inviteResult', html);
        }
        show('#inviteResult');
    } catch (err) {
        setHTML('#inviteResult', `<div style="padding:12px; background:#fef2f2; border:1px solid #fca5a5; border-radius:8px; color:var(--danger)">❌ Failed to send invite: ${err.message}</div>`);
        show('#inviteResult');
    } finally {
        btn.textContent = '🎤 Send Interview Invite';
        btn.disabled = false;
    }
}

/* ---------- Work Experience ---------- */
function renderWorkExperience(c) {
    const exp = c.work_experience || [];
    const container = document.getElementById('workExperience');

    if (exp.length === 0) {
        container.innerHTML = '<p class="text-muted">No work experience data available.</p>';
        return;
    }

    container.innerHTML = exp.map(e => `
        <div class="timeline-item">
            <div class="timeline-role">${e.role || 'Unknown Role'}</div>
            <div class="timeline-company">${e.company || ''}</div>
            <div class="timeline-duration">${e.duration || ''}</div>
            <div class="timeline-desc">${e.description || ''}</div>
        </div>
    `).join('');
}

/* ---------- Education ---------- */
function renderEducation(c) {
    const edu = c.education || [];
    const certs = c.certifications || [];
    const container = document.getElementById('educationSection');

    let html = '';

    if (edu.length > 0) {
        html += edu.map(e => `
            <div style="margin-bottom:12px">
                <div class="fw-600">${e.degree || ''}</div>
                <div class="text-muted text-sm">${e.institution || ''} ${e.year ? '• ' + e.year : ''}</div>
            </div>
        `).join('');
    }

    if (certs.length > 0) {
        html += '<h3 style="font-size:14px; margin-top:16px; margin-bottom:8px">📜 Certifications</h3>';
        html += `<div class="skill-tags">${certs.map(c => `<span class="skill-tag highlight">${c}</span>`).join('')}</div>`;
    }

    if (!html) html = '<p class="text-muted">No education or certification data.</p>';
    container.innerHTML = html;
}

/* ---------- Generate Report ---------- */
async function generateReport() {
    if (!candidateData) return;
    const candidateId = candidateData.id || candidateData.candidate_id;
    if (!candidateId) { alert('No candidate ID found.'); return; }

    show('#reportSection');
    show('#reportLoading');
    hide('#reportChartSection');
    hide('#reportOutput');
    document.getElementById('reportSection').scrollIntoView({ behavior: 'smooth' });

    try {
        const data = await apiGet(`/interview_report/${encodeURIComponent(candidateId)}`);
        hide('#reportLoading');

        document.getElementById('reportOutput').textContent = JSON.stringify(data, null, 2);
        show('#reportOutput');

        // Render charts from report data
        const report = data.report || data;
        if (report.skill_scores) {
            show('#reportChartSection');
            renderCChart('rptSkillRadar', 'radar', Object.keys(report.skill_scores), Object.values(report.skill_scores), 'Skill Score');
            renderCChart('rptSkillScores', 'bar', Object.keys(report.skill_scores), Object.values(report.skill_scores), 'Skill Score');
        }
        const transcript = report.transcript || data.transcript || [];
        if (transcript.length > 0) {
            show('#reportChartSection');
            renderCChart('rptScoreTrend', 'line', transcript.map((_, i) => 'Q' + (i + 1)), transcript.map(q => (q.evaluation?.score || q.analysis?.score || 0)), 'Answer Score');
        }
    } catch (err) {
        hide('#reportLoading');
        document.getElementById('reportOutput').textContent = 'Error generating report: ' + err.message;
        show('#reportOutput');
    }
}

function closeReport() {
    hide('#reportSection');
}

/* ---------- Chart Helper ---------- */
function renderCChart(canvasId, type, labels, data, label) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

    const opts = type === 'radar'
        ? { scales: { r: { suggestedMin: 0, suggestedMax: 10 } } }
        : { responsive: true, scales: { y: { min: 0, max: 10 } } };

    chartInstances[canvasId] = new Chart(ctx, {
        type,
        data: {
            labels,
            datasets: [{
                label,
                data,
                tension: type === 'line' ? 0.3 : undefined,
                backgroundColor: type === 'bar' ? 'rgba(37,99,235,0.7)' : undefined,
                borderColor: type === 'line' ? 'rgba(37,99,235,1)' : undefined
            }]
        },
        options: opts
    });
}

/* ---------- Overall Feedback & Recommendation ---------- */
function renderOverallFeedback(c) {
    const fb = c.overall_feedback;
    const container = document.getElementById('overallFeedback');
    const chartSection = document.getElementById('skillRatingsChartSection');

    if (!fb) {
        container.innerHTML = '<p class="text-muted">No overall feedback available yet.</p>';
        hide('#skillRatingsChartSection');
        hide('#overallFeedbackSection');
        return;
    }

    const recMap = {
        'advance_to_next_round': { label: 'Advance to Next Round', cls: 'rec-advance', icon: '✅' },
        'reject': { label: 'Reject', cls: 'rec-reject', icon: '❌' },
        'hold_for_review': { label: 'Hold for Review', cls: 'rec-hold', icon: '⏸️' }
    };
    const rec = recMap[fb.recommendation] || { label: fb.recommendation || 'Unknown', cls: 'rec-hold', icon: '❓' };

    const confMap = { 'high': 'conf-high', 'medium': 'conf-medium', 'low': 'conf-low' };
    const confCls = confMap[fb.confidence_level] || 'conf-medium';

    container.innerHTML = `
        <div class="feedback-header">
            <div class="recommendation-badge ${rec.cls}">
                <span class="rec-icon">${rec.icon}</span>
                <span class="rec-label">${rec.label}</span>
            </div>
            <div class="confidence-badge ${confCls}">Confidence: ${fb.confidence_level || 'N/A'}</div>
        </div>
        ${fb.recommendation_reason ? `<p class="feedback-reason">${fb.recommendation_reason}</p>` : ''}
        ${fb.overall_summary ? `<div class="feedback-summary"><strong>Summary:</strong> ${fb.overall_summary}</div>` : ''}
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:16px">
            <div>
                <h4 style="font-size:13px; color:var(--accent-dark, #059669); margin-bottom:8px">💪 Strengths</h4>
                ${(fb.strengths || []).map(s => `<div class="text-sm" style="padding:3px 0">• ${s}</div>`).join('') || '<span class="text-muted text-sm">None identified</span>'}
            </div>
            <div>
                <h4 style="font-size:13px; color:var(--danger, #dc2626); margin-bottom:8px">📈 Areas for Improvement</h4>
                ${(fb.areas_for_improvement || []).map(a => `<div class="text-sm" style="padding:3px 0">• ${a}</div>`).join('') || '<span class="text-muted text-sm">None identified</span>'}
            </div>
        </div>
    `;

    // Skill ratings horizontal bar chart
    const ratings = fb.skill_ratings;
    if (ratings && Object.keys(ratings).length > 0) {
        show('#skillRatingsChartSection');
        const labels = Object.keys(ratings).map(k => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));
        const data = Object.values(ratings);
        const colors = data.map(v => v >= 7 ? 'rgba(16,185,129,0.8)' : v >= 4 ? 'rgba(245,158,11,0.8)' : 'rgba(239,68,68,0.8)');
        const ctx = document.getElementById('cSkillRatings');
        if (chartInstances['cSkillRatings']) chartInstances['cSkillRatings'].destroy();
        chartInstances['cSkillRatings'] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{ label: 'Rating', data, backgroundColor: colors, borderRadius: 4 }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                scales: { x: { min: 0, max: 10, title: { display: true, text: 'Score (0-10)' } } },
                plugins: { legend: { display: false } }
            }
        });
    } else {
        hide('#skillRatingsChartSection');
    }
}

/* ---------- Proctoring & Integrity ---------- */
function getFlagSeverity(type) {
    const high = ['face_not_visible', 'additional_person', 'no_face', 'proxy_detected'];
    const medium = ['tab_switch', 'window_blur', 'lip_sync_mismatch'];
    if (high.includes(type)) return 'high';
    if (medium.includes(type)) return 'medium';
    return 'low';
}

function getFlagIcon(type) {
    const icons = {
        'tab_switch': '🔀', 'window_blur': '📱', 'lip_sync_mismatch': '🗣️',
        'head_tilted': '🔄', 'face_not_visible': '👤', 'additional_person': '👥',
        'no_face': '🚫', 'looking_away': '👀', 'proxy_detected': '🎭'
    };
    return icons[type] || '⚠️';
}

function formatTimestamp(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function renderProctoring(c) {
    const proctoring = c.proctoring;
    const overview = document.getElementById('proctoringOverview');
    const chartsSection = document.getElementById('proctoringCharts');

    if (!proctoring || !proctoring.flags || proctoring.flags.length === 0) {
        overview.innerHTML = '<p class="text-muted">No proctoring data available.</p>';
        hide('#proctoringCharts');
        hide('#proctoringSection');
        return;
    }

    const flags = proctoring.flags;
    const totalFlags = flags.reduce((sum, f) => sum + (f.count || 1), 0);
    const uniqueTypes = flags.length;
    const highSev = flags.filter(f => getFlagSeverity(f.type) === 'high').length;
    const medSev = flags.filter(f => getFlagSeverity(f.type) === 'medium').length;
    const lowSev = flags.filter(f => getFlagSeverity(f.type) === 'low').length;
    const hasVideo = !!(proctoring.video_url || proctoring.video_s3_key);

    // Compute interview duration from timestamps
    const maxTs = Math.max(...flags.map(f => f.last_timestamp || f.timestamp || 0));
    const startedAt = proctoring.interview_started_at ? new Date(proctoring.interview_started_at) : null;

    // Integrity score: start at 100, deduct per flag severity
    let integrity = 100;
    flags.forEach(f => {
        const count = f.count || 1;
        const sev = getFlagSeverity(f.type);
        if (sev === 'high') integrity -= count * 15;
        else if (sev === 'medium') integrity -= count * 5;
        else integrity -= count * 2;
    });
    integrity = Math.max(0, Math.min(100, integrity));
    const intColor = integrity >= 70 ? 'var(--accent, #10b981)' : integrity >= 40 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)';

    overview.innerHTML = `
        <div class="proctoring-stats">
            <div class="stat-card">
                <div class="stat-value" style="color:${intColor}">${integrity}%</div>
                <div class="stat-label">Integrity Score</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${totalFlags}</div>
                <div class="stat-label">Total Flags</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${uniqueTypes}</div>
                <div class="stat-label">Flag Types</div>
            </div>
            <div class="stat-card">
                <div class="stat-value severity-high">${highSev}</div>
                <div class="stat-label">High Severity</div>
            </div>
            <div class="stat-card">
                <div class="stat-value severity-medium">${medSev}</div>
                <div class="stat-label">Medium Severity</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${hasVideo ? '🎥 Yes' : '—'}</div>
                <div class="stat-label">Video Recorded</div>
            </div>
        </div>
    `;

    // Flag distribution doughnut chart
    const typeLabels = flags.map(f => f.type.replace(/_/g, ' '));
    const typeCounts = flags.map(f => f.count || 1);
    const sevColors = flags.map(f => {
        const sev = getFlagSeverity(f.type);
        if (sev === 'high') return 'rgba(239,68,68,0.8)';
        if (sev === 'medium') return 'rgba(245,158,11,0.8)';
        return 'rgba(59,130,246,0.8)';
    });

    const dCtx = document.getElementById('cFlagDistribution');
    if (chartInstances['cFlagDistribution']) chartInstances['cFlagDistribution'].destroy();
    chartInstances['cFlagDistribution'] = new Chart(dCtx, {
        type: 'doughnut',
        data: {
            labels: typeLabels,
            datasets: [{ data: typeCounts, backgroundColor: sevColors, borderWidth: 2, borderColor: '#fff' }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 11 } } }
            }
        }
    });

    // Flag timeline scatter chart
    const typeIndexMap = {};
    flags.forEach((f, i) => { typeIndexMap[f.type] = i; });
    const scatterData = flags.map(f => ({ x: f.timestamp, y: typeIndexMap[f.type], r: Math.max(6, (f.count || 1) * 4) }));

    const tCtx = document.getElementById('cFlagTimeline');
    if (chartInstances['cFlagTimeline']) chartInstances['cFlagTimeline'].destroy();
    chartInstances['cFlagTimeline'] = new Chart(tCtx, {
        type: 'bubble',
        data: {
            datasets: [{
                label: 'Flags',
                data: scatterData,
                backgroundColor: scatterData.map((_, i) => sevColors[i])
            }]
        },
        options: {
            responsive: true,
            scales: {
                x: { title: { display: true, text: 'Time (seconds)' }, min: 0 },
                y: {
                    title: { display: true, text: 'Flag Type' },
                    ticks: {
                        callback: function(value) {
                            const entry = Object.entries(typeIndexMap).find(([, v]) => v === value);
                            return entry ? entry[0].replace(/_/g, ' ') : '';
                        },
                        stepSize: 1
                    },
                    min: -0.5,
                    max: flags.length - 0.5
                }
            },
            plugins: { legend: { display: false } }
        }
    });

    // Flag detail items
    const detailHtml = flags.map(f => {
        const sev = getFlagSeverity(f.type);
        return `
        <div class="flag-item flag-severity-${sev}">
            <div class="flag-item-header">
                <span class="flag-icon">${getFlagIcon(f.type)}</span>
                <span class="flag-type">${f.type.replace(/_/g, ' ')}</span>
                <span class="flag-count-badge">${f.count || 1}x</span>
                <span class="flag-severity-label severity-${sev}">${sev}</span>
            </div>
            <div class="flag-item-body">
                <div class="text-sm text-muted">${f.description || ''}</div>
                <div class="flag-timestamps text-sm">
                    <span>First: ${formatTimestamp(f.timestamp)}s</span>
                    ${f.last_timestamp ? `<span>Last: ${formatTimestamp(f.last_timestamp)}s</span>` : ''}
                    ${f.created_at ? `<span>${formatDate(f.created_at)}</span>` : ''}
                </div>
            </div>
        </div>`;
    }).join('');
    document.getElementById('flagDetailsList').innerHTML = detailHtml;

    // Snapshot gallery
    const snaps = flags.filter(f => f.snapshot_url);
    if (snaps.length > 0) {
        document.getElementById('snapshotGallery').innerHTML = `
            <h3 style="font-size:14px; margin-bottom:12px">📸 Flagged Snapshots</h3>
            <div class="snapshot-grid">
                ${snaps.map(f => `
                    <a href="${f.snapshot_url}" target="_blank" class="snapshot-thumb" title="${f.type.replace(/_/g, ' ')} at ${formatTimestamp(f.timestamp)}">
                        <img src="${f.snapshot_url}" alt="${f.type}" loading="lazy">
                        <div class="snapshot-label">${getFlagIcon(f.type)} ${formatTimestamp(f.timestamp)}</div>
                    </a>
                `).join('')}
            </div>
        `;
    }

    // Video player
    if (proctoring.video_url) {
        document.getElementById('proctoringVideo').innerHTML = `
            <h3 style="font-size:14px; margin-bottom:12px">🎥 Interview Recording</h3>
            <video controls preload="metadata" style="width:100%; max-height:400px; border-radius:8px; background:#000">
                <source src="${proctoring.video_url}" type="video/webm">
                Your browser does not support video playback.
            </video>
        `;
    }
}

function toggleProctoringDetails() {
    const section = document.getElementById('proctoringDetails');
    if (section.classList.contains('hidden')) show('#proctoringDetails');
    else hide('#proctoringDetails');
}

/* ---------- Util ---------- */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
/* ---- END: Ishita - Candidate profile JS ---- */
