let ws;
let currentCandidate = "";


/* ===============================
   Resume Upload
================================ */

async function uploadResume(){

    const name = document.getElementById("candidateNameResume").value
    const file = document.getElementById("resumeFile").files[0]

    if(!name || !file){
        return alert("Enter candidate name and select resume")
    }

    const formData = new FormData()
    formData.append("file",file)

    const res = await fetch(`/upload_resume/${name}`,{
        method:"POST",
        body:formData
    })

    const data = await res.json()

    document.getElementById("resumeResult").textContent =
        JSON.stringify(data,null,2)
}


/* ===============================
   Upload Multiple Resumes
================================ */

async function uploadMultipleResumes() {

    const fileInput = document.getElementById("multiResumes");
    const files = fileInput.files;
    if (!files || files.length === 0) {
        alert("Please select resume files");
        return;
    }
    const formData = new FormData();
    // append all files using the same key: "files"
    for (let i = 0; i < files.length; i++) {
        formData.append("files", files[i]);
    }
    try {
        const response = await fetch("/upload_resumes", {
            method: "POST",
            body: formData
        });
        const data = await response.json();
        document.getElementById("resumeResult").textContent =
            JSON.stringify(data, null, 2);
    } catch (error) {
        console.error("Upload failed:", error);
        alert("Upload failed");
    }
}



/* ===============================
   Load Candidates
================================ */

async function loadCandidates(){

    const res = await fetch("/analytics")
    const data = await res.json()

    console.log("Candidates loaded")
}


/* ===============================
   Gap Analysis
================================ */

async function gapAnalysisNew(){

    const candidate =
        document.getElementById("candidateSelectElement").value

    const file = document.getElementById("jdGapFile").files[0]

    if(!candidate || !file){
        return alert("Select candidate and JD file")
    }

    const formData = new FormData()
    formData.append("file",file)

    await fetch(`/upload_jd/${candidate}`,{
        method:"POST",
        body:formData
    })

    const res = await fetch(`/gap_analysis/${candidate}`)
    const data = await res.json()

    document.getElementById("gapResult").textContent =
        JSON.stringify(data,null,2)
}


/* ===============================
   Compare Candidates
================================ */

//async function compareCandidates(){
//
//    const jdFile = document.getElementById("compareJD").files[0]
//    const resumes = document.getElementById("compareResumes").files
//    const topN = document.getElementById("topN").value
//
//    if(!jdFile || !resumes.length){
//        return alert("Upload JD and resumes")
//    }
//
//    // upload resumes
//    const formData = new FormData()
//
//    for(let r of resumes){
//        formData.append("files", r)
//    }
//
//    const uploadRes = await fetch("/upload_resumes",{
//        method:"POST",
//        body:formData
//    })
//
//    const uploadData = await uploadRes.json()
//
//    const candidateIds =
//        uploadData.candidates.map(c => c.candidate_id)
//
//    const jdText = await jdFile.text()
//
//    const res = await fetch("/rank_candidates",{
//        method:"POST",
//        headers:{
//            "Content-Type":"application/json"
//        },
//        body:JSON.stringify({
//            jd_text:jdText,
//            candidate_ids:candidateIds,
//            top_n:parseInt(topN)
//        })
//    })
//
//    const data = await res.json()
//
//    document.getElementById("rankingResult").textContent =
//        JSON.stringify(data,null,2)
//}

async function compareCandidates(){

    const jdFile = document.getElementById("compareJD").files[0]
    const resumes = document.getElementById("compareResumes").files
    const topN = document.getElementById("topN").value
    if(!jdFile || resumes.length === 0){
        alert("Please upload JD and resumes")
        return
    }
    try{
        /* =========================
           Step 1: Upload resumes
        ========================= */

        const resumeForm = new FormData()

        for(let r of resumes){
            resumeForm.append("files", r)
        }

        const uploadRes = await fetch("/upload_resumes",{
            method:"POST",
            body:resumeForm
        })

        const uploadData = await uploadRes.json()
        const candidateIds =
            uploadData.candidates.map(c => c.candidate_id)
        console.log("Uploaded Candidates:", candidateIds)
        /* =========================
           Step 2: Send JD + candidates
        ========================= */
        const formData = new FormData()
        formData.append("jd_file", jdFile)
        formData.append("candidate_ids", JSON.stringify(candidateIds))
        formData.append("top_n", topN)

        const res = await fetch("/rank_candidates",{
            method:"POST",
            body:formData
        })
        const data = await res.json()
        /* =========================
           Step 3: Show result
        ========================= */
        const resultBox = document.getElementById("rankingResult")
        if(data.error){
            resultBox.textContent = "Error: " + data.error
            return
        }
        resultBox.textContent = JSON.stringify(data,null,2)
    }catch(err){
        console.error(err)
        document.getElementById("rankingResult").textContent =
            "Error running candidate comparison"

    }
}

/* ===============================
   Knowledge Base
================================ */

async function uploadKnowledge(){

    const file =
        document.getElementById("knowledgeFile").files[0]

    if(!file){
        return alert("Select knowledge file")
    }

    const formData = new FormData()
    formData.append("file",file)

    const res = await fetch(`/upload_knowledge`,{
        method:"POST",
        body:formData
    })

    const data = await res.json()

    document.getElementById("knowledgeResult").textContent =
        JSON.stringify(data,null,2)
}

async function listKnowledge(){

    const res = await fetch(`/knowledge_files`)

    const data = await res.json()

    document.getElementById("knowledgeResult").textContent =
        JSON.stringify(data,null,2)
}


/* ===============================
   AI Interview
================================ */

function startInterview(){

    currentCandidate =
        document.getElementById("candidateNameInterview").value

    if(!currentCandidate){
        return alert("Select candidate")
    }

    ws = new WebSocket(
        `ws://${window.location.host}/ws/interview/${currentCandidate}`
    )

    document.getElementById("interviewArea").style.display="block"

    ws.onmessage = (event)=>{

        const data = JSON.parse(event.data)

        if(data.question){

            document.getElementById("questionBox").textContent =
                `Skill: ${data.skill}\n\nQuestion:\n${data.question}`

        }

        if(data.message){

            alert(data.message)
        }
    }

    ws.onclose = ()=>{
        alert("Interview finished")
    }
}


async function sendAnswer(){

    const answer =
        document.getElementById("answerInput").value

    if(!answer){
        return
    }

    ws.send(answer)

    document.getElementById("transcriptArea").textContent +=
        `Answer: ${answer}\n\n`

    document.getElementById("answerInput").value=""
}


/* ===============================
   Voice Input
================================ */

function startVoice(){

    if(!('webkitSpeechRecognition' in window)){
        return alert("Voice not supported")
    }

    const recognition = new webkitSpeechRecognition()

    recognition.lang='en-US'

    recognition.onresult = function(event){

        const spoken = event.results[0][0].transcript

        document.getElementById("answerInput").value = spoken
    }

    recognition.start()
}


/* ===============================
   Reports
================================ */

async function getReport(){
    const candidate =
        document.getElementById("candidateSelectReport").value
    if(!candidate){
        alert("Please select candidate")
        return
    }
    const resultBox = document.getElementById("reportResult")
    resultBox.textContent = "Generating report..."
    try{
        const res = await fetch(`/interview_report/${candidate}`)
        const data = await res.json()
        resultBox.textContent =
            JSON.stringify(data,null,2)
        renderSkillRadar(data.skill_scores)
        renderScoreTrend(data.transcript || [])
        renderSkillScoreChart(data.skill_scores)
        renderStrengthWeaknessChart(data.transcript)
        renderSkillCategoryChart(data.category_scores)
    }catch(err){
        console.error(err)
        resultBox.textContent =
            "Error generating report"
    }
}


async function getAnalytics(){
    const res = await fetch("/candidate_comparison")
    const data = await res.json()
    document.getElementById("analyticsResult").textContent =
        JSON.stringify(data,null,2)
    renderCandidateComparison(data.candidates)
}


/* ===============================
   Load candidates in select list
================================ */
let allCandidates = []


//   Load candidates when page loads
document.addEventListener("DOMContentLoaded", loadCandidates)

async function loadCandidates(){
    const res = await fetch("/candidates")
    const data = await res.json()
    allCandidates = data.candidates
    const dropdown = document.getElementById("candidateSelectElement")
    dropdown.innerHTML = '<option value="">Select Candidate</option>'
    allCandidates.forEach(c => {
        const option = document.createElement("option")
        option.value = c.candidate_id
        option.text = c.name + " (" + c.candidate_id + ")"
        dropdown.appendChild(option)
    })
}

/* ===============================
   filter candidates for Gap analysis
================================ */
function searchCandidate(){

    const searchText =
        document.getElementById("candidateSearchGap")   // FIX
        .value
        .toLowerCase()

    const dropdown =
        document.getElementById("candidateSelectElement")

    dropdown.innerHTML = '<option value="">Select Candidate</option>'

    allCandidates
        .filter(c =>
            c.name.toLowerCase().includes(searchText) ||
            c.candidate_id.toLowerCase().includes(searchText)
        )
        .forEach(c => {

            const option = document.createElement("option")

            option.value = c.candidate_id
            option.text = c.name + " (" + c.candidate_id + ")"

            dropdown.appendChild(option)

        })
}



/* ===============================
   select candidate
================================ */
function selectCandidate(){

    const dropdown =
        document.getElementById("candidateSelectElement")

    const selected = dropdown.value

    console.log("Selected Candidate:", selected)

}

//=====================
//submit transcript
//=====================

async function submitTranscript() {
    const candidate =
        document.getElementById("candidateSelectSubmitTranscript").value;
    if(!candidate){
        alert("Please select candidate")
        return
    }
    const transcriptText =
        document.getElementById("manualTranscript").value.trim()
    if(!transcriptText){
        alert("Please paste transcript")
        return
    }
    try{
        const res = await fetch(`/submit_transcript/${candidate}`,{
            method:"POST",
            headers:{
                "Content-Type":"application/json"
            },
            body: JSON.stringify({
                transcript: transcriptText
            })
        })
        const data = await res.json()
        document.getElementById("submitResult").textContent =
            JSON.stringify(data,null,2)
    }catch(err){
        console.error(err)
        document.getElementById("submitResult").textContent =
            "Error submitting transcript"
    }
}


/* ===============================
   filter candidates for submit Transcript
================================ */
function searchCandidateSubmitTranscript(){

    const searchText =
        document.getElementById("candidateSearchSubmitTranscript")   // FIX
        .value
        .toLowerCase()

    const dropdown =
        document.getElementById("candidateSelectSubmitTranscript")

    dropdown.innerHTML = '<option value="">Select Candidate</option>'

    allCandidates
        .filter(c =>
            c.name.toLowerCase().includes(searchText) ||
            c.candidate_id.toLowerCase().includes(searchText)
        )
        .forEach(c => {
            const option = document.createElement("option")
            option.value = c.candidate_id
            option.text = c.name + " (" + c.candidate_id + ")"
            dropdown.appendChild(option)

        })
}

/* ===============================
   select candidate for submit Transcript
================================ */
function selectCandidateSubmitTranscript(){

    const dropdown =
        document.getElementById("candidateSelectSubmitTranscript")

    const selected = dropdown.value

    console.log("Selected Candidate:", selected)
}

/* ===============================
   Load candidates for submit Transcript
================================ */
let allCandidates2 = []
//   Load candidates when page loads
document.addEventListener("DOMContentLoaded", loadCandidatesSubmitTranscript)
async function loadCandidatesSubmitTranscript(){
    const res = await fetch("/candidates")
    const data = await res.json()
    allCandidates2 = data.candidates
    const dropdown = document.getElementById("candidateSelectSubmitTranscript")
    dropdown.innerHTML = '<option value="">Select Candidate</option>'
    allCandidates2.forEach(c => {
        const option = document.createElement("option")
        option.value = c.candidate_id
        option.text = c.name + " (" + c.candidate_id + ")"
        dropdown.appendChild(option)
    })
}



/* ===============================
   Load candidates in Reports & Analytics
================================ */
let allCandidates3 = []
//   Load candidates when page loads
document.addEventListener("DOMContentLoaded", loadCandidatesForReportAnalytics)

async function loadCandidatesForReportAnalytics(){
    const res = await fetch("/candidates")
    const data = await res.json()
    allCandidates3 = data.candidates
    const dropdown = document.getElementById("candidateSelectReport")
    dropdown.innerHTML = '<option value="">Select Candidate</option>'
    allCandidates3.forEach(c => {
        const option = document.createElement("option")
        option.value = c.candidate_id
        option.text = c.name + " (" + c.candidate_id + ")"
        dropdown.appendChild(option)
    })
}

/* ===============================
   select candidate for Reports & Analytics
================================ */
function selectCandidateForReportAnalytics(){

    const dropdown =
        document.getElementById("candidateSelectReport")

    const selected = dropdown.value

    console.log("Selected Candidate:", selected)
}
/* ===============================
   filter candidates for Reports & Analytics
================================ */
function searchCandidateForReportAnalytics(){
    const searchText =
        document.getElementById("candidateSearchReport")   // FIX
        .value
        .toLowerCase()

    const dropdown =
        document.getElementById("candidateSelectReport")
    dropdown.innerHTML = '<option value="">Select Candidate</option>'
    allCandidates3
        .filter(c =>
            c.name.toLowerCase().includes(searchText) ||
            c.candidate_id.toLowerCase().includes(searchText)
        )
        .forEach(c => {
            const option = document.createElement("option")
            option.value = c.candidate_id
            option.text = c.name + " (" + c.candidate_id + ")"
            dropdown.appendChild(option)
        })
}

//=================
//report metrics
//==================
let skillRadarChart
let scoreTrendChart
let comparisonChart

function renderCandidateComparison(candidates){
    const names = candidates.map(c=>c.name)
    const scores = candidates.map(c=>c.score)
    const ctx = document.getElementById("comparisonChart")
   if(comparisonChart){
        comparisonChart.destroy()
    }

    comparisonChart =  new Chart(ctx,{
        type:"bar",
        data:{
            labels:names,
            datasets:[{
                label:"Overall Score",
                data:scores
            }]
        }
    })
}

function renderScoreTrend(transcript){
    const labels = []
    const scores = []

    transcript.forEach((q,i)=>{
        labels.push("Q"+(i+1))
        scores.push(q.evaluation?.score || 0)
    })
    const ctx = document.getElementById("scoreTrendChart")
    if(scoreTrendChart){
        scoreTrendChart.destroy()
    }
   scoreTrendChart =  new Chart(ctx,{
        type:"line",
        data:{
            labels:labels,
            datasets:[{
                label:"Answer Score",
                data:scores,
                tension:0.3
            }]
        }
    })
}

function renderSkillRadar(skillScores){
    const skills = Object.keys(skillScores)
    const scores = Object.values(skillScores)
    const ctx = document.getElementById("skillRadarChart")
     if(skillRadarChart){
        skillRadarChart.destroy()
    }
    skillRadarChart = new Chart(ctx,{
        type: "radar",
        data: {
            labels: skills,
            datasets: [{
                label: "Skill Score",
                data: scores
            }]
        },
        options:{
            scales:{
                r:{
                    suggestedMin:0,
                    suggestedMax:10
                }
            }
        }
    })
}

//=======================
//Skill Category Analysis
//=======================

//function computeCategoryScores(skillScores){
//    const categoryScores = {}
//    Object.keys(skillScores).forEach(category => {
//        const skills = skillCategories[category]
//        let total = 0
//        let count = 0
//
//        skills.forEach(skill => {
//            if(skillScores[skill] !== undefined){
//                total += skillScores[skill]
//                count++
//            }
//        })
//
//        categoryScores[category] = count ? (total / count).toFixed(2) : 0
//    })
//
//    return categoryScores
//}

let skillChart

function renderSkillScoreChart(skillScores){
//    const categoryScores = computeCategoryScores(skillScores)
    const labels = Object.keys(skillScores)
    const data = Object.values(skillScores)

    const ctx = document.getElementById("skillScoreChart")

    if(skillChart){
        skillChart.destroy()
    }

    skillChart = new Chart(ctx,{
        type:"bar",
        data:{
            labels:labels,
            datasets:[{
                label:"Skill Score",
                data:data
            }]
        },
        options:{
            responsive:true,
            scales:{
                y:{
                    min:0,
                    max:10
                }
            }
        }
    })
}

//======================
//Strengths & Weaknesses
//======================

function computeStrengthWeakness(transcript){
    const strengths = {}
    const weaknesses = {}
    transcript.forEach(q => {
        q.evaluation?.strengths?.forEach(s=>{
            strengths[s] = (strengths[s] || 0) + 1
        })
        q.evaluation?.weaknesses?.forEach(w=>{
            weaknesses[w] = (weaknesses[w] || 0) + 1
        })
    })
    return {strengths, weaknesses}
}

function prepareStrengthWeaknessData(transcript){
    const {strengths, weaknesses} = computeStrengthWeakness(transcript)
    const labels = [...new Set([
        ...Object.keys(strengths),
        ...Object.keys(weaknesses)
    ])]
    const strengthCounts = labels.map(l => strengths[l] || 0)
    const weaknessCounts = labels.map(l => weaknesses[l] || 0)
    return {labels, strengthCounts, weaknessCounts}
}

let strengthWeaknessChart

function renderStrengthWeaknessChart(transcript){
    const {labels, strengthCounts, weaknessCounts} =
        prepareStrengthWeaknessData(transcript)
    const ctx = document.getElementById("strengthWeaknessChart")
    if(strengthWeaknessChart){
        strengthWeaknessChart.destroy()
    }
    strengthWeaknessChart = new Chart(ctx,{
        type:"bar",
        data:{
            labels:labels,
            datasets:[
                {
                    label:"Strengths",
                    data:strengthCounts,
                    stack:"analysis"
                },
                {
                    label:"Weaknesses",
                    data:weaknessCounts,
                    stack:"analysis"
                }
            ]
        },
        options:{
            responsive:true,
            scales:{
                x:{ stacked:true },
                y:{ stacked:true }
            }
        }
    })
}


let categoryChart

function renderSkillCategoryChart(categoryScores){

    const labels = Object.keys(categoryScores)
    const data = Object.values(categoryScores)

    const ctx = document
        .getElementById("skillCategoryChart")

    if(categoryChart){
        categoryChart.destroy()
    }

    categoryChart = new Chart(ctx,{
        type:"bar",
        data:{
            labels:labels,
            datasets:[{
                label:"Category Score",
                data:data
            }]
        },
        options:{
            responsive:true,
            scales:{
                y:{
                    min:0,
                    max:10
                }
            }
        }
    })
}