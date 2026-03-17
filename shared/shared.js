/* ---- START: Ishita - Shared JS utilities: API helpers, DOM utils, formatters, navigation, dropdown population, skill tags, progress stepper, loading states ---- */
/* ===================================================
   Shared Utilities — AI Hiring Platform
   =================================================== */

const API_BASE = '';

/* ---------- HTTP Helpers ---------- */

async function apiGet(url) {
    const res = await fetch(`${API_BASE}${url}`);
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
    return res.json();
}

async function apiPost(url, body) {
    const res = await fetch(`${API_BASE}${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`POST ${url} failed: ${res.status}`);
    return res.json();
}

async function apiPostForm(url, formData) {
    const res = await fetch(`${API_BASE}${url}`, {
        method: 'POST',
        body: formData
    });
    if (!res.ok) throw new Error(`POST ${url} failed: ${res.status}`);
    return res.json();
}

/* ---------- DOM Helpers ---------- */

function $(selector) { return document.querySelector(selector); }
function $$(selector) { return document.querySelectorAll(selector); }

function show(el) { if (typeof el === 'string') el = $(el); el?.classList.remove('hidden'); }
function hide(el) { if (typeof el === 'string') el = $(el); el?.classList.add('hidden'); }

function setHTML(selector, html) {
    const el = $(selector);
    if (el) el.innerHTML = html;
}

function setText(selector, text) {
    const el = $(selector);
    if (el) el.textContent = text;
}

/* ---------- Formatters ---------- */

function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function getScoreClass(score) {
    if (score >= 70) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
}

function getScoreColor(score) {
    if (score >= 70) return 'var(--accent)';
    if (score >= 40) return 'var(--warning)';
    return 'var(--danger)';
}

function getBadgeClass(status) {
    const map = {
        'completed': 'badge-success',
        'active': 'badge-primary',
        'pending': 'badge-warning',
        'disconnected': 'badge-danger',
        'not_started': 'badge-neutral'
    };
    return map[status] || 'badge-neutral';
}

function truncate(str, len = 80) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '…' : str;
}

function formatDate(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ---------- Candidate Key Generator ---------- */

function generateCandidateKey(name) {
    const cleanName = name.trim().toLowerCase().split(' ');
    const first = cleanName[0] || '';
    const last = cleanName[cleanName.length - 1] || '';
    const year = new Date().getFullYear();
    const month = new Date().toLocaleString('en', { month: 'short' }).toLowerCase();
    const uid = Math.random().toString(16).slice(2, 10);
    return `resume_${first}_${year}_${month}_${uid}`;
}

/* ---------- Navigation ---------- */

function showBlock(name) {
    $$('.block').forEach(b => b.classList.add('hidden'));
    const block = document.getElementById(name);
    if (block) block.classList.remove('hidden');

    $$('.sidebar button').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`[data-section="${name}"]`);
    if (btn) btn.classList.add('active');
}

/* ---------- Populate Dropdowns ---------- */

function populateDropdown(selectId, candidates, valueFn, labelFn) {
    const dd = document.getElementById(selectId);
    if (!dd) return;
    dd.innerHTML = '<option value="">Select Candidate</option>';
    candidates.forEach(c => {
        const opt = document.createElement('option');
        opt.value = valueFn(c);
        opt.textContent = labelFn(c);
        dd.appendChild(opt);
    });
}

function filterDropdown(inputId, selectId, candidates, valueFn, labelFn) {
    const search = document.getElementById(inputId)?.value?.toLowerCase() || '';
    const filtered = candidates.filter(c =>
        labelFn(c).toLowerCase().includes(search) ||
        valueFn(c).toLowerCase().includes(search)
    );
    populateDropdown(selectId, filtered, valueFn, labelFn);
}

/* ---------- Skill Tag Renderer ---------- */

function renderSkillTags(skills, matchedSet, missingSet) {
    return skills.map(s => {
        let cls = 'skill-tag';
        if (matchedSet && matchedSet.has(s.toLowerCase())) cls += ' matched';
        else if (missingSet && missingSet.has(s.toLowerCase())) cls += ' missing';
        return `<span class="${cls}">${s}</span>`;
    }).join('');
}

/* ---------- Progress Stepper Renderer ---------- */

function renderProgressStepper(stages, currentIndex) {
    return `<div class="progress-stepper">${stages.map((s, i) => {
        let cls = 'step';
        if (i < currentIndex) cls += ' completed';
        else if (i === currentIndex) cls += ' active';
        return `<div class="${cls}">
            <span class="step-dot">${i < currentIndex ? '✓' : i + 1}</span>
            <span class="step-label">${s}</span>
        </div>`;
    }).join('')}</div>`;
}

/* ---------- Gap Analysis Bar ---------- */

function renderGapBar(label, percent) {
    const cls = getScoreClass(percent);
    return `<div class="gap-bar-container">
        <div class="gap-bar-label"><span>${label}</span><span>${Math.round(percent)}%</span></div>
        <div class="gap-bar"><div class="gap-bar-fill ${cls}" style="width:${percent}%"></div></div>
    </div>`;
}

/* ---------- Loading States ---------- */

function showLoading(containerId) {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = '<div class="text-center mt-4"><div class="spinner"></div><p class="text-muted text-sm mt-4">Analyzing with AI...</p></div>';
}

function clearLoading(containerId) {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = '';
}
/* ---- END: Ishita - Shared JS utilities ---- */
