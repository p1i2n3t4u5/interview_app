let candidateData = null;
let mediaStream = null;
let ws = null;
let recognition = null;
let isListening = false;
let currentAnswer = "";
let currentAudio = null;
let totalQuestions = 0;
let photoCaptureInterval = null;
let interviewToken = null;

// On page load, validate the token from URL
document.addEventListener("DOMContentLoaded", async () => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    interviewToken = token;

    if (!token) {
        showError("No interview token provided. Please use the link from your invitation email.");
        return;
    }

    try {
        const res = await fetch(`/validate_token?token=${encodeURIComponent(token)}`);
        const data = await res.json();

        if (!data.valid) {
            showError(data.error || "This link is invalid or has expired.");
            return;
        }

        candidateData = data;
        totalQuestions = data.total_questions || 0;
        showPermissionState(data.candidate_name);
    } catch (err) {
        showError("Unable to connect to the server. Please try again later.");
    }
});

function showError(message) {
    document.getElementById("loadingState").style.display = "none";
    document.getElementById("errorState").style.display = "flex";
    document.getElementById("errorMessage").textContent = message;
}

function showPermissionState(name) {
    document.getElementById("loadingState").style.display = "none";
    document.getElementById("permissionState").style.display = "flex";
    document.getElementById("candidateName").textContent = name;
    document.getElementById("readyCandidateName").textContent = name;
    const totalQEl = document.getElementById("totalQuestionsInfo");
    if (totalQEl && totalQuestions > 0) {
        totalQEl.textContent = totalQuestions;
    }
    // Initialize progress bar with actual count
    updateProgress(0, totalQuestions || "--");
}

async function requestMediaAccess() {
    const cameraStatus = document.getElementById("cameraStatus");
    const micStatus = document.getElementById("micStatus");
    const permissionError = document.getElementById("permissionError");
    const enableBtn = document.getElementById("enableMediaBtn");

    permissionError.style.display = "none";
    enableBtn.disabled = true;
    enableBtn.textContent = "Requesting access...";

    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });

        cameraStatus.className = "status-dot granted";
        micStatus.className = "status-dot granted";

        document.getElementById("permissionState").style.display = "none";
        document.getElementById("readyState").style.display = "flex";

        const video = document.getElementById("videoPreview");
        video.srcObject = mediaStream;
    } catch (err) {
        enableBtn.disabled = false;
        enableBtn.textContent = "Enable Camera & Microphone";

        if (err.name === "NotAllowedError") {
            cameraStatus.className = "status-dot denied";
            micStatus.className = "status-dot denied";
            permissionError.style.display = "block";
        } else if (err.name === "NotFoundError") {
            showError("Camera or microphone not found. Please connect them and refresh the page.");
        } else {
            showError("An error occurred while accessing your camera/microphone: " + err.message);
        }
    }
}

// ===========================
// Interview Flow
// ===========================

function startInterview() {
    document.getElementById("readyState").style.display = "none";
    document.getElementById("interviewState").style.display = "flex";

    // Move video stream to interview view
    const interviewVideo = document.getElementById("interviewVideo");
    interviewVideo.srcObject = mediaStream;

    setStatus("connecting", "Connecting...");

    // Start random photo capture
    startPhotoCapture();

    const token = new URLSearchParams(window.location.search).get("token");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${protocol}//${window.location.host}/ws/ai_interview/${token}`);

    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);

        // Stop any previous audio and mic before handling new message
        stopCurrentAudio();
        stopListening();

        switch (data.type) {
            case "greeting":
                updateProgress(0, data.total_questions);
                setStatus("speaking", "AI is speaking...");
                addToTranscript("ai", data.text);
                await playAudio(data.audio);
                beginListening();
                break;

            case "question":
                updateProgress(data.question_number, data.total_questions);
                updateSkillBadge(data.skill_area, data.difficulty);
                setStatus("speaking", "AI is speaking...");
                addToTranscript("ai", data.text);
                await playAudio(data.audio);
                beginListening();
                break;

            case "complete":
                setStatus("complete", "Interview complete");
                if (data.audio) await playAudio(data.audio);
                showComplete(data.text || data.message);
                break;

            case "error":
                showInterviewError(data.message);
                break;
        }
    };

    ws.onerror = () => {
        showInterviewError("Connection error. Please check your internet and try again.");
    };

    ws.onclose = () => {
        stopListening();
    };
}

// ===========================
// Audio Playback
// ===========================

function playAudio(base64Audio) {
    return new Promise((resolve) => {
        if (!base64Audio) {
            resolve();
            return;
        }
        // Stop any existing audio first
        stopCurrentAudio();
        // Mute mic during AI speech to prevent feedback
        muteMic(true);
        currentAudio = new Audio(`data:audio/mp3;base64,${base64Audio}`);
        currentAudio.onended = () => { muteMic(false); resolve(); };
        currentAudio.onerror = () => { muteMic(false); resolve(); };
        currentAudio.play().catch(() => { muteMic(false); resolve(); });
    });
}

function stopCurrentAudio() {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
    }
}

function muteMic(mute) {
    if (mediaStream) {
        mediaStream.getAudioTracks().forEach(track => {
            track.enabled = !mute;
        });
    }
}

// ===========================
// Speech Recognition
// ===========================

function beginListening() {
    currentAnswer = "";
    const answerArea = document.getElementById("answerArea");
    const textAnswer = document.getElementById("textAnswer");
    const submitBtn = document.getElementById("submitAnswerBtn");

    answerArea.style.display = "block";
    textAnswer.value = "";
    submitBtn.disabled = true;
    setStatus("listening", "Listening... speak or type your answer");

    // Enable submit button when user types
    textAnswer.addEventListener("input", onTextInput);

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        setStatus("typing", "Speech not supported. Please type your answer.");
        submitBtn.disabled = false;
        return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let finalTranscript = "";
    let hasSpoken = false;
    let silenceTimer = null;

    recognition.onresult = (event) => {
        let interim = "";
        finalTranscript = "";

        for (let i = 0; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript + " ";
            } else {
                interim += event.results[i][0].transcript;
            }
        }

        hasSpoken = true;
        currentAnswer = finalTranscript + interim;
        // Update the unified textarea with speech recognition results
        textAnswer.value = currentAnswer;
        submitBtn.disabled = false;

        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
            if (hasSpoken && finalTranscript.trim()) {
                currentAnswer = finalTranscript.trim();
                submitCurrentAnswer();
            }
        }, 5000);
    };

    recognition.onerror = (event) => {
        if (event.error === "no-speech") {
            try { recognition.start(); } catch (e) {}
        }
    };

    recognition.onend = () => {
        if (isListening && !hasSpoken) {
            try { recognition.start(); } catch (e) {}
        }
    };

    isListening = true;
    try { recognition.start(); } catch (e) {}
}

function onTextInput() {
    const textAnswer = document.getElementById("textAnswer");
    const submitBtn = document.getElementById("submitAnswerBtn");
    submitBtn.disabled = !textAnswer.value.trim();
}

function stopListening() {
    isListening = false;
    if (recognition) {
        try { recognition.stop(); } catch (e) {}
        recognition = null;
    }
}

function submitCurrentAnswer() {
    stopListening();

    const textAnswer = document.getElementById("textAnswer");
    const text = currentAnswer.trim() || textAnswer.value.trim();
    if (!text) return;

    setStatus("analyzing", "Analyzing your response...");
    addToTranscript("user", text);

    document.getElementById("answerArea").style.display = "none";
    textAnswer.removeEventListener("input", onTextInput);
    textAnswer.value = "";
    currentAnswer = "";

    ws.send(JSON.stringify({ type: "answer", text: text }));
}

function manualSubmit() {
    const textInput = document.getElementById("textAnswer").value.trim();
    if (textInput) {
        currentAnswer = textInput;
    }
    if (!currentAnswer.trim() && !textInput) return;
    submitCurrentAnswer();
}

// ===========================
// UI Helpers
// ===========================

function setStatus(type, text) {
    const indicator = document.getElementById("statusIndicator");
    const statusText = document.getElementById("statusText");
    const answerStatus = document.getElementById("answerStatus");
    const pulseIcon = document.getElementById("statusIcon");

    statusText.textContent = text;
    indicator.className = "status-indicator " + type;

    if (answerStatus) {
        if (type === "listening") {
            answerStatus.textContent = "Listening... speak your answer";
            if (pulseIcon) pulseIcon.className = "pulse-dot listening";
        } else if (type === "analyzing") {
            answerStatus.textContent = "Analyzing your response...";
            if (pulseIcon) pulseIcon.className = "pulse-dot analyzing";
        } else if (type === "typing") {
            answerStatus.textContent = "Type your answer below";
            if (pulseIcon) pulseIcon.className = "pulse-dot";
        }
    }
}

function updateProgress(current, total) {
    const pct = Math.round((current / total) * 100);
    document.getElementById("progressFill").style.width = pct + "%";
    document.getElementById("progressText").textContent = `${current} / ${total}`;
}

function updateSkillBadge(skill, difficulty) {
    const badge = document.getElementById("skillBadge");
    const skillText = document.getElementById("currentSkill");
    badge.style.display = "block";
    skillText.textContent = `${skill} (${difficulty})`;
}

function addToTranscript(role, text) {
    const display = document.getElementById("transcriptDisplay");
    const entry = document.createElement("div");
    entry.className = "transcript-entry " + (role === "ai" ? "ai-message" : "user-message");

    const label = document.createElement("div");
    label.className = "transcript-label";
    label.textContent = role === "ai" ? "AI Interviewer" : "You";

    const content = document.createElement("div");
    content.className = "transcript-text";
    content.textContent = text;

    entry.appendChild(label);
    entry.appendChild(content);
    display.appendChild(entry);
    display.scrollTop = display.scrollHeight;
}

function showComplete(message) {
    stopListening();
    stopPhotoCapture();
    document.getElementById("interviewState").style.display = "none";
    document.getElementById("completeState").style.display = "flex";
    document.getElementById("completeMessage").textContent = message;

    if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
    }
}

function showInterviewError(message) {
    stopListening();
    setStatus("error", message);
    addToTranscript("ai", "Error: " + message);
}

// ===========================
// Photo Capture to S3
// ===========================

function startPhotoCapture() {
    captureAndUploadPhoto("");
    // Capture at random intervals between 15-45 seconds
    scheduleNextCapture();
}

function scheduleNextCapture() {
    const delay = (15 + Math.random() * 30) * 1000;
    photoCaptureInterval = setTimeout(() => {
        captureAndUploadPhoto("");
        scheduleNextCapture();
    }, delay);
}

function stopPhotoCapture() {
    if (photoCaptureInterval) {
        clearTimeout(photoCaptureInterval);
        photoCaptureInterval = null;
    }
}

function captureAndUploadPhoto(flag) {
    const video = document.getElementById("interviewVideo");
    if (!video || !video.srcObject) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const photoData = canvas.toDataURL("image/jpeg", 0.7);

    fetch("/upload_photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            token: interviewToken,
            photo: photoData,
            flag: flag
        })
    }).catch(err => console.warn("Photo upload failed:", err));
}

// ===========================
// Tab Visibility Detection
// ===========================

document.addEventListener("visibilitychange", () => {
    if (document.hidden && document.getElementById("interviewState").style.display !== "none") {
        captureAndUploadPhoto("tab_switch");
        addToTranscript("ai", "Warning: Tab switch detected. Please stay on this page during the interview.");
    }
});

window.addEventListener("blur", () => {
    if (document.getElementById("interviewState").style.display !== "none") {
        captureAndUploadPhoto("window_blur");
    }
});
