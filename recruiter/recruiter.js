/* ---- START: Ishita - Recruiter dashboard JS: resume upload, JD gap analysis, candidate search, compare/rank, schedule interview, reports/charts ---- */
/* ===================================================
   Recruiter Dashboard — JavaScript
   =================================================== */

let allCandidatesData = [];
let chartInstances = {};

/* ---------- Init ---------- */
document.addEventListener('DOMContentLoaded', async () => {
    await loadAllCandidates();
    renderAllCandidatesView();
    renderSearchResults('');
});

/* =================================
   1. Upload Resumes
================================= */

async function recruiterUploadResumes() {
    const fileInput = document.getElementById('resumeFiles');
    const files = fileInput.files;
    if (!files || files.length === 0) {
        alert('Please select one or more resume PDF files.');
        return;
    }

    show('#uploadProgress');
    hide('#uploadResults');

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
    }

    try {
        const data = await apiPostForm('/upload_resumes', formData);

        hide('#uploadProgress');

        const results = data.candidates || [];
        let html = `<div class="stats-grid">
            <div class="stat-card"><div class="stat-value">${results.length}</div><div class="stat-label">Resumes Processed</div></div>
        </div>`;

        results.forEach(r => {
            const parsed = r.parsed_resume || {};
            const skillsHtml = (parsed.skills || []).slice(0, 10).map(s =>
                `<span class="skill-tag highlight">${s}</span>`
            ).join('');

            html += `
            <div class="upload-result-item">
                <div class="candidate-avatar">${getInitials(parsed.name || '')}</div>
                <div style="flex:1">
                    <div class="fw-600">${parsed.name || 'Unknown'}</div>
                    <div class="text-muted text-sm">${parsed.email || ''} ${parsed.phone ? '• ' + parsed.phone : ''}</div>
                    <div class="key-badge">🔑 ${r.candidate_id}</div>
                    <div class="skill-tags mt-4">${skillsHtml}</div>
                </div>
                <a href="/candidate?id=${encodeURIComponent(r.candidate_id)}" class="btn btn-outline btn-sm">View Profile →</a>
            </div>`;
        });

        setHTML('#uploadResults', html);
        show('#uploadResults');

        // Refresh candidates list in background
        await loadAllCandidates();
    } catch (err) {
        hide('#uploadProgress');
        setHTML('#uploadResults', `<p style="color:var(--danger)">Upload failed: ${err.message}</p>`);
        show('#uploadResults');
    }
}

/* =================================
   2. Load All Candidates
================================= */

async function loadAllCandidates() {
    try {
        const data = await apiGet('/recruiter/candidates');
        allCandidatesData = data.candidates || [];
    } catch {
        // Fallback to old endpoint
        try {
            const data = await apiGet('/candidates');
            allCandidatesData = (data.candidates || []).map(c => ({
                candidate_id: c.candidate_id,
                name: c.name,
                skills: c.skills || [],
                email: '',
                interview_status: 'not_started',
                match_percent: 0,
                interview_score: 0
            }));
        } catch { allCandidatesData = []; }
    }
    populateAllDropdowns();
}

function populateAllDropdowns() {
    const valFn = c => c.candidate_id;
    const lblFn = c => `${c.name} (${c.candidate_id})`;
    populateDropdown('interviewCandidateSelect', allCandidatesData, valFn, lblFn);
    populateDropdown('reportCandidateSelect', allCandidatesData, valFn, lblFn);
    renderJDCandidateCheckboxes(allCandidatesData);
}

/* =================================
   3. JD Gap Analysis
================================= */

function renderJDCandidateCheckboxes(candidates) {
    const container = document.getElementById('jdCandidateCheckboxes');
    if (!container) return;
    container.innerHTML = candidates.map(c => `
        <div class="candidate-checkbox-item">
            <input type="checkbox" id="jd_cb_${c.candidate_id}" value="${c.candidate_id}">
            <label for="jd_cb_${c.candidate_id}">${c.name} <span class="text-muted text-sm">(${c.candidate_id})</span></label>
        </div>
    `).join('');
}

function filterJDCandidates() {
    const search = document.getElementById('jdCandidateSearch')?.value?.toLowerCase() || '';
    const filtered = allCandidatesData.filter(c =>
        c.name.toLowerCase().includes(search) ||
        c.candidate_id.toLowerCase().includes(search) ||
        (c.skills || []).some(s => s.toLowerCase().includes(search))
    );
    renderJDCandidateCheckboxes(filtered);
}

function selectAllJDCandidates() {
    document.querySelectorAll('#jdCandidateCheckboxes input[type="checkbox"]').forEach(cb => cb.checked = true);
}

function getSelectedJDCandidates() {
    const checked = document.querySelectorAll('#jdCandidateCheckboxes input[type="checkbox"]:checked');
    return Array.from(checked).map(cb => cb.value);
}

async function analyzeJDGap() {
    const jdFile = document.getElementById('jdFile')?.files[0];
    const candidateIds = getSelectedJDCandidates();

    if (!jdFile) { alert('Please upload a Job Description PDF.'); return; }
    if (candidateIds.length === 0) { alert('Please select at least one candidate.'); return; }

    show('#jdAnalysisLoading');
    setHTML('#gapAnalysisResults', '');

    try {
        const data = await apiPostForm('/recruiter/jd_gap_analysis', (() => {
            const fd = new FormData();
            fd.append('jd_file', jdFile);
            fd.append('candidate_ids', JSON.stringify(candidateIds));
            return fd;
        })());

        hide('#jdAnalysisLoading');
        renderGapResults(data);
    } catch (err) {
        hide('#jdAnalysisLoading');
        setHTML('#gapAnalysisResults', `<p style="color:var(--danger)">Analysis failed: ${err.message}</p>`);
    }
}

function renderGapResults(data) {
    const results = data.results || [];
    const jdSkills = data.jd_skills || [];

    let html = `<div class="stats-grid">
        <div class="stat-card"><div class="stat-value">${results.length}</div><div class="stat-label">Candidates Analyzed</div></div>
        <div class="stat-card"><div class="stat-value">${jdSkills.length}</div><div class="stat-label">JD Skills Extracted</div></div>
    </div>
    <div class="mb-4"><strong>JD Skills:</strong> <div class="skill-tags mt-4">${jdSkills.map(s => `<span class="skill-tag">${s}</span>`).join('')}</div></div>`;

    // Sort by match_percent descending
    results.sort((a, b) => b.match_percent - a.match_percent);

    results.forEach(r => {
        const matchedSet = new Set((r.matched_skills || []).map(s => s.toLowerCase()));
        const missingSet = new Set((r.missing_skills || []).map(s => s.toLowerCase()));
        const allSkills = [...(r.matched_skills || []), ...(r.missing_skills || [])];

        html += `
        <div class="gap-result-card">
            <h3>
                <a href="/candidate?id=${encodeURIComponent(r.candidate_id)}">${r.name || r.candidate_id}</a>
                <span class="badge ${r.match_percent >= 70 ? 'badge-success' : r.match_percent >= 40 ? 'badge-warning' : 'badge-danger'}" style="margin-left:10px">${Math.round(r.match_percent)}% Match</span>
            </h3>
            ${renderGapBar('Skill Match', r.match_percent)}
            <div class="gap-summary">
                <div class="gap-summary-item">
                    <h4>✅ Matched Skills (${(r.matched_skills||[]).length})</h4>
                    <div class="skill-tags">${(r.matched_skills || []).map(s => `<span class="skill-tag matched">${s}</span>`).join('') || '<span class="text-muted text-sm">None</span>'}</div>
                </div>
                <div class="gap-summary-item">
                    <h4>❌ Missing Skills (${(r.missing_skills||[]).length})</h4>
                    <div class="skill-tags">${(r.missing_skills || []).map(s => `<span class="skill-tag missing">${s}</span>`).join('') || '<span class="text-muted text-sm">None</span>'}</div>
                </div>
            </div>
        </div>`;
    });

    setHTML('#gapAnalysisResults', html);
}

/* =================================
   4. Search Candidates
================================= */

function globalSearchCandidates() {
    const query = document.getElementById('globalSearch')?.value?.toLowerCase() || '';
    renderSearchResults(query);
}

function renderSearchResults(query) {
    const container = document.getElementById('searchResults');
    if (!container) return;

    let filtered = allCandidatesData;
    if (query) {
        filtered = allCandidatesData.filter(c =>
            c.name.toLowerCase().includes(query) ||
            c.candidate_id.toLowerCase().includes(query) ||
            (c.email || '').toLowerCase().includes(query) ||
            (c.skills || []).some(s => s.toLowerCase().includes(query))
        );
    }

    if (filtered.length === 0) {
        container.innerHTML = '<p class="text-muted text-center mt-6">No candidates found.</p>';
        return;
    }

    container.innerHTML = filtered.map(c => {
        const matchedSkillsForQuery = query ? (c.skills || []).filter(s => s.toLowerCase().includes(query)) : [];
        const skillsHtml = (c.skills || []).slice(0, 8).map(s => {
            const isHighlight = matchedSkillsForQuery.some(ms => ms.toLowerCase() === s.toLowerCase());
            return `<span class="skill-tag ${isHighlight ? 'highlight' : ''}">${s}</span>`;
        }).join('');

        const statusBadge = c.interview_status ?
            `<span class="badge ${getBadgeClass(c.interview_status)}">${c.interview_status.replace('_', ' ')}</span>` : '';

        return `
        <div class="candidate-card" onclick="window.location.href='/candidate?id=${encodeURIComponent(c.candidate_id)}'">
            <div class="candidate-avatar">${getInitials(c.name)}</div>
            <div class="candidate-info">
                <a class="candidate-name" href="/candidate?id=${encodeURIComponent(c.candidate_id)}">${c.name}</a>
                ${statusBadge}
                <div class="candidate-meta">🔑 ${c.candidate_id} ${c.email ? '• ' + c.email : ''}</div>
                <div class="skill-tags mt-4">${skillsHtml}</div>
            </div>
            ${c.interview_score ? `<div class="candidate-score"><div class="score-value" style="color:${getScoreColor(c.interview_score * 10)}">${c.interview_score}/10</div><div class="text-muted text-sm">Score</div></div>` : ''}
        </div>`;
    }).join('');
}

/* =================================
   5. All Candidates View
================================= */

function renderAllCandidatesView() {
    const total = allCandidatesData.length;
    const interviewed = allCandidatesData.filter(c => c.interview_status === 'completed').length;
    const pending = allCandidatesData.filter(c => c.interview_status === 'pending' || c.interview_status === 'active').length;

    setHTML('#candidateStats', `
        <div class="stat-card"><div class="stat-value">${total}</div><div class="stat-label">Total Candidates</div></div>
        <div class="stat-card"><div class="stat-value" style="color:var(--accent)">${interviewed}</div><div class="stat-label">Interviewed</div></div>
        <div class="stat-card"><div class="stat-value" style="color:var(--warning)">${pending}</div><div class="stat-label">Pending</div></div>
        <div class="stat-card"><div class="stat-value" style="color:var(--primary)">${total - interviewed - pending}</div><div class="stat-label">New</div></div>
    `);

    renderSearchResults('');
    // Reuse search results container for all candidates
    const allContainer = document.getElementById('candidateList');
    if (allContainer) {
        allContainer.innerHTML = allCandidatesData.map(c => {
            const skillsHtml = (c.skills || []).slice(0, 6).map(s =>
                `<span class="skill-tag">${s}</span>`
            ).join('');
            const statusBadge = c.interview_status ?
                `<span class="badge ${getBadgeClass(c.interview_status)}">${c.interview_status.replace('_', ' ')}</span>` : '';

            return `
            <div class="candidate-card" onclick="window.location.href='/candidate?id=${encodeURIComponent(c.candidate_id)}'">
                <div class="candidate-avatar">${getInitials(c.name)}</div>
                <div class="candidate-info">
                    <a class="candidate-name" href="/candidate?id=${encodeURIComponent(c.candidate_id)}">${c.name}</a>
                    ${statusBadge}
                    <div class="candidate-meta">🔑 ${c.candidate_id}</div>
                    <div class="skill-tags mt-4">${skillsHtml}</div>
                </div>
                ${c.interview_score ? `<div class="candidate-score"><div class="score-value" style="color:${getScoreColor(c.interview_score * 10)}">${c.interview_score}/10</div><div class="text-muted text-sm">Avg Score</div></div>` : ''}
            </div>`;
        }).join('') || '<p class="text-muted text-center mt-6">No candidates yet. Upload resumes to get started.</p>';
    }
}

async function refreshCandidates() {
    await loadAllCandidates();
    renderAllCandidatesView();
}

/* =================================
   6. Compare & Rank Candidates
================================= */

async function compareAndRank() {
    const jdFile = document.getElementById('compareJDFile')?.files[0];
    const resumeFiles = document.getElementById('compareResumeFiles')?.files;
    const topN = document.getElementById('compareTopN')?.value || 5;

    if (!jdFile) { alert('Please upload a JD.'); return; }
    if (!resumeFiles || resumeFiles.length === 0) { alert('Please upload resumes.'); return; }

    show('#comparisonLoading');
    setHTML('#comparisonResults', '');

    try {
        // Step 1: Upload resumes
        const resumeForm = new FormData();
        for (let r of resumeFiles) resumeForm.append('files', r);
        const uploadData = await apiPostForm('/upload_resumes', resumeForm);
        const candidateIds = (uploadData.candidates || []).map(c => c.candidate_id);

        // Step 2: Rank
        const rankForm = new FormData();
        rankForm.append('jd_file', jdFile);
        rankForm.append('candidate_ids', JSON.stringify(candidateIds));
        rankForm.append('top_n', topN);
        const rankData = await apiPostForm('/rank_candidates', rankForm);

        hide('#comparisonLoading');

        // Render results
        const top = rankData.top_candidates || [];
        let html = `<div class="mb-4"><strong>JD Skills:</strong> <div class="skill-tags mt-4">${(rankData.jd_skills || []).map(s => `<span class="skill-tag">${s}</span>`).join('')}</div></div>`;

        top.forEach((c, i) => {
            const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
            const jdSkillsSet = new Set((rankData.jd_skills || []).map(s => s.toLowerCase()));
            const skillsHtml = (c.skills || []).map(s => {
                const isMatch = jdSkillsSet.has(s.toLowerCase());
                return `<span class="skill-tag ${isMatch ? 'matched' : ''}">${s}</span>`;
            }).join('');

            html += `
            <div class="rank-card">
                <div class="rank-number ${rankClass}">${i + 1}</div>
                <div class="candidate-avatar">${getInitials(c.candidate)}</div>
                <div style="flex:1">
                    <a class="candidate-name" href="/candidate?id=${encodeURIComponent(c.candidate_id)}">${c.candidate}</a>
                    <div class="candidate-meta">🔑 ${c.candidate_id}</div>
                    <div class="skill-tags mt-4">${skillsHtml}</div>
                </div>
                <div class="candidate-score">
                    <div class="score-value" style="color:${getScoreColor(c.match_score)}">${c.match_score}%</div>
                    <div class="text-muted text-sm">Match</div>
                </div>
            </div>`;
        });

        setHTML('#comparisonResults', html);

        // Refresh candidates list
        await loadAllCandidates();
    } catch (err) {
        hide('#comparisonLoading');
        setHTML('#comparisonResults', `<p style="color:var(--danger)">Comparison failed: ${err.message}</p>`);
    }
}

/* =================================
   7. Schedule Interview
================================= */

function filterInterviewCandidates() {
    const valFn = c => c.candidate_id;
    const lblFn = c => `${c.name} (${c.candidate_id})`;
    filterDropdown('interviewCandidateSearch', 'interviewCandidateSelect', allCandidatesData, valFn, lblFn);
}

function selectInterviewCandidate() {
    const id = document.getElementById('interviewCandidateSelect')?.value;
    const c = allCandidatesData.find(x => x.candidate_id === id);
    const preview = document.getElementById('interviewCandidatePreview');
    if (!c || !preview) { hide('#interviewCandidatePreview'); return; }

    preview.innerHTML = `
        <div class="candidate-card">
            <div class="candidate-avatar">${getInitials(c.name)}</div>
            <div class="candidate-info">
                <div class="fw-600">${c.name}</div>
                <div class="candidate-meta">📧 ${c.email || 'N/A'} • 🔑 ${c.candidate_id}</div>
            </div>
        </div>`;
    show('#interviewCandidatePreview');
}

async function sendInterviewInvite() {
    const id = document.getElementById('interviewCandidateSelect')?.value;
    const c = allCandidatesData.find(x => x.candidate_id === id);
    if (!c) { alert('Select a candidate first.'); return; }

    try {
        const data = await apiPost('/send_email', {
            name: c.name,
            email: c.email || '',
            id: c.candidate_id
        });

        const resultDiv = document.getElementById('interviewResult');
        if (data.status === 'sent' || data.status === 'email_failed') {
            resultDiv.innerHTML = `
                <div class="card" style="border-left:4px solid var(--accent); margin-top:12px">
                    <div class="fw-600">✅ Interview Scheduled</div>
                    <div class="text-sm text-muted mt-4">Token: <code>${data.token}</code></div>
                    <div class="text-sm mt-4">Link: <a href="${data.interview_url}" target="_blank">${data.interview_url}</a></div>
                    ${data.email_error ? `<div class="text-sm" style="color:var(--warning); margin-top:8px">⚠️ Email delivery failed: ${data.email_error}</div>` : ''}
                </div>`;
        } else {
            resultDiv.innerHTML = `<p style="color:var(--danger)">${data.error || 'Failed to schedule interview.'}</p>`;
        }
    } catch (err) {
        setHTML('#interviewResult', `<p style="color:var(--danger)">Error: ${err.message}</p>`);
    }
}

/* =================================
   8. Reports & Analytics
================================= */

function filterReportCandidates() {
    const valFn = c => c.candidate_id;
    const lblFn = c => `${c.name} (${c.candidate_id})`;
    filterDropdown('reportCandidateSearch', 'reportCandidateSelect', allCandidatesData, valFn, lblFn);
}

async function getRecruiterReport() {
    const id = document.getElementById('reportCandidateSelect')?.value;
    if (!id) { alert('Select a candidate.'); return; }

    try {
        const data = await apiGet(`/interview_report/${id}`);
        const out = document.getElementById('reportOutput');
        out.textContent = JSON.stringify(data, null, 2);
        show('#reportOutput');

        // Charts
        if (data.skill_scores) renderChart('rSkillRadar', 'radar', Object.keys(data.skill_scores), Object.values(data.skill_scores), 'Skill Score');
        if (data.transcript) renderChart('rScoreTrend', 'line', data.transcript.map((_, i) => 'Q' + (i + 1)), data.transcript.map(q => q.evaluation?.score || 0), 'Answer Score');
        if (data.skill_scores) renderChart('rSkillScores', 'bar', Object.keys(data.skill_scores), Object.values(data.skill_scores), 'Skill Score');
    } catch (err) {
        setHTML('#reportOutput', `Error: ${err.message}`);
        show('#reportOutput');
    }
}

async function getRecruiterAnalytics() {
    try {
        const data = await apiGet('/candidate_comparison');
        const candidates = data.candidates || [];
        renderChart('rComparison', 'bar', candidates.map(c => c.name), candidates.map(c => c.score), 'Overall Score');

        const out = document.getElementById('reportOutput');
        out.textContent = JSON.stringify(data, null, 2);
        show('#reportOutput');
    } catch (err) {
        setHTML('#reportOutput', `Error: ${err.message}`);
        show('#reportOutput');
    }
}

function renderChart(canvasId, type, labels, data, label) {
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
/* ---- END: Ishita - Recruiter dashboard JS ---- */
