/**
 * ProctorMonitor - Real-time interview proctoring with:
 * - Video recording & S3 upload
 * - Face detection & eye tracking (face-api.js)
 * - Object detection: phones, books, extra screens (COCO-SSD)
 * - Lip sync / proxy detection
 * - Flagged snapshot capture & upload
 */
class ProctorMonitor {
    constructor(videoElement, mediaStream, token) {
        this.video = videoElement;
        this.stream = mediaStream;
        this.token = token;

        // MediaRecorder
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.chunkUploadInterval = null;
        this.recordingStartTime = null;

        // Detection
        this.faceDetectionInterval = null;
        this.objectDetectionInterval = null;
        this.cocoModel = null;
        this.faceModelsLoaded = false;
        this.objectModelLoaded = false;

        // Canvas for COCO-SSD (needs canvas input)
        this.canvas = document.createElement("canvas");
        this.ctx = this.canvas.getContext("2d");

        // Flag tracking
        this.flags = [];
        this.flagCounts = {};   // Track how many times each flag type has been raised
        this.lastFlagTime = {};
        this.FLAG_COOLDOWN_MS = 15000; // 15s cooldown between same flag type

        // Face tracking state
        this.noFaceCount = 0;
        this.lookAwayCount = 0;
        this.CONSECUTIVE_THRESHOLD = 4; // 4 detections at 500ms = 2 seconds

        // Lip sync state
        this.mouthOpenHistory = [];
        this.MAX_MOUTH_HISTORY = 10;

        // Audio analysis
        this.audioContext = null;
        this.analyser = null;
        this.audioDataArray = null;

        this.isRunning = false;
    }

    // ===========================
    // Initialization
    // ===========================

    async initialize() {
        console.log("[Proctor] Loading detection models...");

        // Load face-api.js models
        try {
            if (typeof faceapi !== "undefined") {
                const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/";
                await Promise.all([
                    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
                    faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL)
                ]);
                this.faceModelsLoaded = true;
                console.log("[Proctor] Face detection models loaded");
            } else {
                console.warn("[Proctor] face-api.js not available");
            }
        } catch (e) {
            console.warn("[Proctor] Failed to load face models:", e);
        }

        // Load COCO-SSD model
        try {
            if (typeof cocoSsd !== "undefined") {
                this.cocoModel = await cocoSsd.load({ base: "lite_mobilenet_v2" });
                this.objectModelLoaded = true;
                console.log("[Proctor] Object detection model loaded");
            } else {
                console.warn("[Proctor] COCO-SSD not available");
            }
        } catch (e) {
            console.warn("[Proctor] Failed to load COCO-SSD:", e);
        }

        // Setup audio analysis for lip sync
        this.setupAudioAnalysis();
    }

    setupAudioAnalysis() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = this.audioContext.createMediaStreamSource(this.stream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 512;
            source.connect(this.analyser);
            this.audioDataArray = new Uint8Array(this.analyser.frequencyBinCount);
            console.log("[Proctor] Audio analysis ready");
        } catch (e) {
            console.warn("[Proctor] Audio analysis setup failed:", e);
        }
    }

    isAudioActive() {
        if (!this.analyser || !this.audioDataArray) return false;
        this.analyser.getByteFrequencyData(this.audioDataArray);
        const average = this.audioDataArray.reduce((a, b) => a + b, 0) / this.audioDataArray.length;
        return average > 15;
    }

    // ===========================
    // Video Recording
    // ===========================

    startRecording() {
        let mimeType = "video/webm;codecs=vp9";
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = "video/webm;codecs=vp8";
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                mimeType = "video/webm";
            }
        }

        this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });
        this.recordedChunks = [];
        this.recordingStartTime = Date.now();

        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                this.recordedChunks.push(event.data);
            }
        };

        // Collect data every 5 seconds
        this.mediaRecorder.start(5000);

        // Upload accumulated video backup every 30 seconds
        this.chunkUploadInterval = setInterval(() => this.uploadVideoBackup(), 30000);

        console.log("[Proctor] Recording started");
    }

    async uploadVideoBackup() {
        if (this.recordedChunks.length === 0) return;

        const blob = new Blob(this.recordedChunks, { type: "video/webm" });
        const formData = new FormData();
        formData.append("file", blob, "backup.webm");
        formData.append("token", this.token);
        formData.append("chunk_index", "0");

        try {
            await fetch("/api/upload_video_chunk", { method: "POST", body: formData });
            console.log("[Proctor] Video backup uploaded (" + Math.round(blob.size / 1024) + " KB)");
        } catch (e) {
            console.warn("[Proctor] Video backup upload failed:", e);
        }
    }

    // ===========================
    // Detection Engine
    // ===========================

    startDetection() {
        this.isRunning = true;

        this.canvas.width = this.video.videoWidth || 640;
        this.canvas.height = this.video.videoHeight || 480;

        // Face detection every 500ms
        if (this.faceModelsLoaded) {
            this.faceDetectionInterval = setInterval(() => this.runFaceDetection(), 500);
            console.log("[Proctor] Face detection started (every 500ms)");
        }

        // Object detection every 3s (heavier model)
        if (this.objectModelLoaded) {
            this.objectDetectionInterval = setInterval(() => this.runObjectDetection(), 3000);
            console.log("[Proctor] Object detection started (every 3s)");
        }
    }

    // ===========================
    // Face Detection & Eye Tracking
    // ===========================

    async runFaceDetection() {
        if (!this.isRunning || !this.video.videoWidth) return;

        try {
            const detections = await faceapi
                .detectAllFaces(this.video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.3 }))
                .withFaceLandmarks(true);

            const videoWidth = this.video.videoWidth;
            const videoHeight = this.video.videoHeight;
            const centerX = videoWidth / 2;
            const centerY = videoHeight / 2;

            // === No face detected ===
            if (detections.length === 0) {
                this.noFaceCount++;
                this.lookAwayCount = 0;
                if (this.noFaceCount >= this.CONSECUTIVE_THRESHOLD) {
                    this.raiseFlag("face_not_visible", "No face detected - candidate may have left the frame or is looking away");
                    this.noFaceCount = 0;
                }
                return;
            }

            this.noFaceCount = 0;

            // === Multiple faces ===
            if (detections.length > 1) {
                this.raiseFlag("multiple_faces", `${detections.length} faces detected - possible third party assistance`);
            }

            const face = detections[0];
            const box = face.detection.box;
            const landmarks = face.landmarks;

            // === Face position / looking away ===
            const faceCenterX = box.x + box.width / 2;
            const faceCenterY = box.y + box.height / 2;

            const xDeviation = Math.abs(faceCenterX - centerX) / videoWidth;
            const yDeviation = Math.abs(faceCenterY - centerY) / videoHeight;

            if (xDeviation > 0.3 || yDeviation > 0.35) {
                this.lookAwayCount++;
                if (this.lookAwayCount >= this.CONSECUTIVE_THRESHOLD) {
                    this.raiseFlag(
                        "eyes_looking_away",
                        `Face significantly off-center (${(xDeviation * 100).toFixed(0)}% horizontal, ${(yDeviation * 100).toFixed(0)}% vertical) - possibly looking at another screen or reading`
                    );
                    this.lookAwayCount = 0;
                }
            } else {
                this.lookAwayCount = 0;
            }

            // === Eye line angle (head tilt) ===
            const leftEye = landmarks.getLeftEye();
            const rightEye = landmarks.getRightEye();

            const leftEyeCenter = {
                x: leftEye.reduce((s, p) => s + p.x, 0) / leftEye.length,
                y: leftEye.reduce((s, p) => s + p.y, 0) / leftEye.length
            };
            const rightEyeCenter = {
                x: rightEye.reduce((s, p) => s + p.x, 0) / rightEye.length,
                y: rightEye.reduce((s, p) => s + p.y, 0) / rightEye.length
            };

            const eyeAngle = Math.atan2(
                rightEyeCenter.y - leftEyeCenter.y,
                rightEyeCenter.x - leftEyeCenter.x
            ) * (180 / Math.PI);

            if (Math.abs(eyeAngle) > 15) {
                this.raiseFlag("head_tilted", `Head significantly tilted (${eyeAngle.toFixed(0)}deg) - unusual posture`);
            }

            // === Lip sync check ===
            this.checkLipSync(landmarks);

        } catch (e) {
            // Silently ignore detection errors to avoid disrupting the interview
        }
    }

    // ===========================
    // Lip Sync / Proxy Detection
    // ===========================

    checkLipSync(landmarks) {
        // Only check when mic is active (candidate should be speaking)
        const audioTrack = this.stream.getAudioTracks()[0];
        if (!audioTrack || !audioTrack.enabled) return;

        const mouth = landmarks.getMouth();
        // getMouth() returns 20 points: outer (0-11) + inner (12-19)
        const innerMouth = mouth.slice(12);
        if (innerMouth.length < 8) return;

        // Mouth aspect ratio
        const top = innerMouth[2];     // top center inner lip
        const bottom = innerMouth[6];  // bottom center inner lip
        const left = innerMouth[0];    // left inner corner
        const right = innerMouth[4];   // right inner corner

        const mouthHeight = Math.hypot(top.x - bottom.x, top.y - bottom.y);
        const mouthWidth = Math.hypot(left.x - right.x, left.y - right.y);
        const MAR = mouthWidth > 0 ? mouthHeight / mouthWidth : 0;

        const mouthIsOpen = MAR > 0.25;
        const audioActive = this.isAudioActive();

        this.mouthOpenHistory.push({ open: mouthIsOpen, audio: audioActive, time: Date.now() });
        if (this.mouthOpenHistory.length > this.MAX_MOUTH_HISTORY) {
            this.mouthOpenHistory.shift();
        }

        // Check sustained mismatch (audio but mouth closed = proxy speaking for candidate)
        if (this.mouthOpenHistory.length >= 8) {
            const recent = this.mouthOpenHistory.slice(-8);
            const audioButNoMouth = recent.filter(r => r.audio && !r.open).length;
            if (audioButNoMouth >= 6) {
                this.raiseFlag(
                    "lip_sync_mismatch",
                    "Audio detected but mouth appears closed - possible proxy interview or audio playback"
                );
                this.mouthOpenHistory = []; // Reset after flag
            }
        }
    }

    // ===========================
    // Object Detection (COCO-SSD)
    // ===========================

    async runObjectDetection() {
        if (!this.isRunning || !this.cocoModel || !this.video.videoWidth) return;

        try {
            this.canvas.width = this.video.videoWidth;
            this.canvas.height = this.video.videoHeight;
            this.ctx.drawImage(this.video, 0, 0);

            const predictions = await this.cocoModel.detect(this.canvas);

            let personCount = 0;

            for (const pred of predictions) {
                const label = pred.class.toLowerCase();
                const confidence = pred.score;

                if (confidence < 0.5) continue;

                if (label === "cell phone") {
                    this.raiseFlag(
                        "phone_detected",
                        `Mobile phone detected (${(confidence * 100).toFixed(0)}% confidence) - candidate may be reading from device`
                    );
                } else if (label === "book") {
                    this.raiseFlag(
                        "book_detected",
                        `Book detected (${(confidence * 100).toFixed(0)}% confidence) - candidate may be reading answers`
                    );
                } else if (label === "laptop") {
                    this.raiseFlag(
                        "extra_screen_detected",
                        `Additional laptop detected (${(confidence * 100).toFixed(0)}% confidence) - candidate may be using another device`
                    );
                } else if (label === "tv" || label === "monitor") {
                    this.raiseFlag(
                        "extra_screen_detected",
                        `Additional screen/monitor detected (${(confidence * 100).toFixed(0)}% confidence)`
                    );
                } else if (label === "person") {
                    personCount++;
                }
            }

            // Multiple people in frame
            if (personCount > 1) {
                this.raiseFlag(
                    "additional_person",
                    `${personCount} people detected in frame - possible third party assistance`
                );
            }
        } catch (e) {
            // Silently ignore
        }
    }

    // ===========================
    // Flag Management
    // ===========================

    raiseFlag(type, description) {
        const now = Date.now();
        const lastTime = this.lastFlagTime[type] || 0;

        // Cooldown: don't spam the same flag type
        if (now - lastTime < this.FLAG_COOLDOWN_MS) return;

        this.lastFlagTime[type] = now;

        // Increment count for this flag type
        this.flagCounts[type] = (this.flagCounts[type] || 0) + 1;

        const timestampSeconds = (now - this.recordingStartTime) / 1000;

        // Check if this flag type already exists in the array
        const existing = this.flags.find(f => f.type === type);

        if (existing) {
            // Update existing: increment count and update timestamp
            existing.count = this.flagCounts[type];
            existing.last_timestamp = Math.round(timestampSeconds * 10) / 10;
            existing.last_description = description;
            existing.last_seen = new Date().toISOString();
            console.log(`[Proctor] FLAG UPDATE: ${type} (count: ${existing.count}) at ${existing.last_timestamp}s`);
        } else {
            // Add new flag entry
            const flag = {
                timestamp: Math.round(timestampSeconds * 10) / 10,
                type: type,
                description: description,
                count: 1,
                created_at: new Date().toISOString()
            };
            this.flags.push(flag);
            console.log(`[Proctor] FLAG: ${type} at ${flag.timestamp}s - ${description}`);
        }

        // Capture and upload snapshot only on first occurrence
        if (this.flagCounts[type] === 1) {
            const flag = this.flags.find(f => f.type === type);
            this.captureAndUploadSnapshot(flag);
        }
    }

    // ===========================
    // Snapshot Capture & Upload
    // ===========================

    async captureAndUploadSnapshot(flag) {
        try {
            const snapshotCanvas = document.createElement("canvas");
            snapshotCanvas.width = this.video.videoWidth || 640;
            snapshotCanvas.height = this.video.videoHeight || 480;
            const ctx = snapshotCanvas.getContext("2d");

            // Draw current video frame
            ctx.drawImage(this.video, 0, 0);

            // Add flag overlay banner
            ctx.fillStyle = "rgba(255, 0, 0, 0.75)";
            ctx.fillRect(0, 0, snapshotCanvas.width, 32);
            ctx.fillStyle = "white";
            ctx.font = "bold 14px Arial";
            ctx.fillText(
                `FLAG: ${flag.type} | ${flag.timestamp}s | ${flag.description}`,
                8, 22
            );

            // Convert to JPEG blob
            const blob = await new Promise(resolve =>
                snapshotCanvas.toBlob(resolve, "image/jpeg", 0.85)
            );

            // Upload to backend
            const formData = new FormData();
            formData.append("file", blob, `${flag.timestamp}_${flag.type}.jpg`);
            formData.append("token", this.token);
            formData.append("timestamp", flag.timestamp.toString());
            formData.append("flag_type", flag.type);
            formData.append("description", flag.description);

            const res = await fetch("/api/upload_snapshot", { method: "POST", body: formData });
            const result = await res.json();

            if (result.s3_key) {
                flag.snapshot_s3_key = result.s3_key;
                console.log(`[Proctor] Snapshot uploaded: ${result.s3_key}`);
            } else if (result.error) {
                console.warn(`[Proctor] Snapshot upload error: ${result.error}`);
            }
        } catch (e) {
            console.warn("[Proctor] Snapshot capture/upload failed:", e);
        }
    }

    // ===========================
    // Start / Stop
    // ===========================

    async start() {
        console.log("[Proctor] Starting proctoring system...");

        // Start recording immediately (doesn't need ML models)
        this.startRecording();

        // Load models asynchronously (detection starts after load)
        try {
            await this.initialize();
            // Short delay for video dimensions to stabilize
            setTimeout(() => this.startDetection(), 2000);
        } catch (e) {
            console.warn("[Proctor] Model loading failed - recording continues without detection:", e);
        }
    }

    async stop() {
        console.log("[Proctor] Stopping proctoring...");
        this.isRunning = false;

        // Stop detection intervals
        if (this.faceDetectionInterval) clearInterval(this.faceDetectionInterval);
        if (this.objectDetectionInterval) clearInterval(this.objectDetectionInterval);
        if (this.chunkUploadInterval) clearInterval(this.chunkUploadInterval);

        // Stop audio context
        if (this.audioContext) {
            try { this.audioContext.close(); } catch (e) {}
        }

        // Stop MediaRecorder and wait for final data
        if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
            await new Promise(resolve => {
                this.mediaRecorder.onstop = resolve;
                this.mediaRecorder.stop();
            });
        }

        // Upload the complete final video
        if (this.recordedChunks.length > 0) {
            const blob = new Blob(this.recordedChunks, { type: "video/webm" });
            console.log(`[Proctor] Uploading final video (${Math.round(blob.size / 1024)} KB)...`);

            const formData = new FormData();
            formData.append("file", blob, "interview.webm");
            formData.append("token", this.token);

            try {
                const res = await fetch("/api/upload_final_video", { method: "POST", body: formData });
                const result = await res.json();
                console.log("[Proctor] Final video uploaded:", result);
            } catch (e) {
                console.warn("[Proctor] Final video upload failed:", e);
            }
        }

        console.log(`[Proctor] Stopped. Total flags raised: ${this.flags.length}`);
        return this.flags;
    }
}
