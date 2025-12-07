import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getFirestore, doc, onSnapshot, updateDoc, setDoc, 
    serverTimestamp, increment, getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// --- FIREBASE CONFIG ---
const firebaseConfig = {
  apiKey: "AIzaSyA6SeNSU6msvU890bucTO463kmyeOE7rDI",
  authDomain: "habit-streak-tracker-j2zli2.firebaseapp.com",
  projectId: "habit-streak-tracker-j2zli2",
  storageBucket: "habit-streak-tracker-j2zli2.firebasestorage.app",
  messagingSenderId: "842193529900",
  appId: "1:842193529900:web:2c7f052531c11b51f67589"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// --- WEB WORKER (Background Thread) ---
const workerBlob = new Blob([`
    let intervalId;
    self.onmessage = function(e) {
        if (e.data === 'start') {
            if (intervalId) clearInterval(intervalId);
            intervalId = setInterval(() => {
                self.postMessage('tick');
            }, 200);
        } else if (e.data === 'stop') {
            clearInterval(intervalId);
        }
    };
`], { type: "text/javascript" });
const timerWorker = new Worker(URL.createObjectURL(workerBlob));

// --- STATE MANAGEMENT ---
let uid = null;
let unsubscribeSnapshot = null;
let isStandby = false;
let controlsTimeout = null;
let wakeLock = null;

let prevHours = null;
let prevMinutes = null;
let prevSeconds = null;

// Initial state
let state = {
    timerValueState: 1500000, 
    timerEndTimestamp: 0,
    pausedRemainingMs: 1500000,
    currentTimerMs: 1500000,
    savedMsThisSession: 0,
    timerRunning: false,
    timerEnded: false,
    finishInProgress: false,
    currentTimerTaskName: "Deep Work"
};

// UI Elements
const els = {
    timeDisplay: document.getElementById('time-display'),
    ring: document.getElementById('timer-ring'),
    mainBtn: document.getElementById('main-btn'),
    mainIcon: document.getElementById('main-icon'),
    resetBtn: document.getElementById('reset-btn'),
    finishBtn: document.getElementById('finish-btn'),
    statusText: document.getElementById('timer-status'),
    statusDot: document.getElementById('status-dot'),
    taskName: document.getElementById('task-name'),
    slider: document.getElementById('duration-slider'),
    syncStatus: document.getElementById('sync-status'),
    enterStandbyBtn: document.getElementById('enter-standby-btn'),
    toast: document.getElementById('toast-container'),
    toastMessage: document.getElementById('toast-message')
};

const standbyEls = {
    overlay: document.getElementById('standby-overlay'),
    controls: document.getElementById('standby-controls'),
    clockContainer: document.getElementById('flip-clock'),
    taskName: document.getElementById('standby-task-name'),
    statusText: document.getElementById('standby-status-text'),
    statusDot: document.getElementById('standby-status-dot'),
    toggleBtn: document.getElementById('standby-toggle-btn'),
    toggleIcon: document.getElementById('standby-toggle-icon'),
    exitBtn: document.getElementById('exit-standby-btn'),
    finishBtn: document.getElementById('standby-finish-btn'),
    wrapper: document.getElementById('flip-clock-wrapper')
};

const RING_CIRCUMFERENCE = 691;

// --- LOCAL STORAGE HELPERS ---
function loadLocalState() {
    try {
        const cached = localStorage.getItem('disciplineX_timerState');
        if (cached) {
            const parsed = JSON.parse(cached);
            if (Date.now() - (parsed.lastUpdatedWeb || 0) < 86400000) {
                state = { ...state, ...parsed };
                updateUI();
                updateStandbyUI();
            }
        }
    } catch (e) { console.log("Cache error", e); }
}

function saveLocalState() {
    try {
        const stateToSave = { ...state, lastUpdatedWeb: Date.now() };
        localStorage.setItem('disciplineX_timerState', JSON.stringify(stateToSave));
    } catch (e) {}
}

// --- INITIALIZATION ---
function init() {
    loadLocalState();
    createFlipClockStructure();

    timerWorker.onmessage = function(e) {
        if (e.data === 'tick') tick();
    };
    timerWorker.postMessage('start');

    onAuthStateChanged(auth, (user) => {
        if (user) {
            uid = user.uid;
            els.syncStatus.textContent = "Synced • " + uid.slice(0, 4);
            els.syncStatus.classList.add("text-brand-mid");
            startFirestoreListener();
        } else {
            els.syncStatus.textContent = "Connecting...";
            signInAnonymously(auth).catch(console.error);
        }
    });
}

// --- FIRESTORE SYNC ---
function startFirestoreListener() {
    const docRef = doc(db, `users/${uid}/appState/timer`);
    
    unsubscribeSnapshot = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            
            state.timerValueState = data.timerValueState ?? 1500000;
            state.timerEndTimestamp = data.timerEndTimestamp ?? 0;
            state.pausedRemainingMs = data.pausedRemainingMs ?? 1500000;
            state.timerRunning = data.timerRunning ?? false;
            state.timerEnded = data.timerEnded ?? false;
            state.savedMsThisSession = data.savedMsThisSession ?? 0;
            state.currentTimerTaskName = (data.currentTimerTaskName && data.currentTimerTaskName.trim() !== "") 
                ? data.currentTimerTaskName : "Deep Work";

            if (state.timerRunning) state.timerEnded = false;
            
            saveLocalState();
            updateUI();
            updateStandbyUI();
            tick(); 
        } else {
            pushStateToFirestore(); 
        }
    });
}

function pushStateToFirestore() {
    saveLocalState();
    if (!uid) return;
    const docRef = doc(db, `users/${uid}/appState/timer`);
    const safeTaskName = (state.currentTimerTaskName && state.currentTimerTaskName.trim() !== "") 
        ? state.currentTimerTaskName : "Deep Work";

    setDoc(docRef, {
        timerValueState: state.timerValueState,
        timerEndTimestamp: state.timerEndTimestamp,
        pausedRemainingMs: state.pausedRemainingMs,
        currentTimerMs: state.currentTimerMs,
        savedMsThisSession: state.savedMsThisSession,
        timerRunning: state.timerRunning,
        timerEnded: state.timerEnded,
        finishInProgress: state.finishInProgress,
        currentTimerTaskName: safeTaskName,
        lastUpdatedWeb: serverTimestamp()
    }, { merge: true }).catch(console.error);
}

// --- CORE TIMER LOGIC ---
function tick() {
    const now = Date.now();

    if (state.timerRunning) {
        const remaining = state.timerEndTimestamp - now;
        
        if (remaining <= 0) {
            state.currentTimerMs = 0;
            state.timerRunning = false;
            state.timerEnded = true; // Temporary flag
            state.pausedRemainingMs = 0;
            finishSessionGlobally();
        } else {
            state.currentTimerMs = remaining;
            
            const totalElapsedTime = state.timerValueState - state.currentTimerMs;
            const unsaved = totalElapsedTime - (state.lastSavedTotal || 0); 
            if (unsaved >= 60000) {
                 saveSessionStats(60000); 
                 state.lastSavedTotal = (state.lastSavedTotal || 0) + 60000;
            }
        }
    } else {
        state.currentTimerMs = state.pausedRemainingMs;
    }

    updateUI();
    if(isStandby) updateStandbyUI();
}

// --- UI UPDATES ---
function updateUI() {
    const minutes = Math.floor(state.currentTimerMs / 60000);
    const seconds = Math.floor((state.currentTimerMs % 60000) / 1000);
    const fmtTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    els.timeDisplay.textContent = fmtTime;
    
    if (state.timerRunning) {
        document.title = `${fmtTime} | Focus`;
    } else if (state.timerEnded) {
        document.title = `Done! | Focus`;
    } else {
        document.title = `Top 1% Club | Focus Timer`;
    }

    const total = state.timerValueState;
    const current = state.currentTimerMs;
    const fraction = Math.max(0, current / total);
    const offset = RING_CIRCUMFERENCE - (fraction * RING_CIRCUMFERENCE);
    els.ring.style.strokeDashoffset = offset;

    if (state.timerRunning) {
        els.statusText.textContent = "Focusing...";
        els.statusDot.className = "w-2 h-2 rounded-full bg-brand-mid animate-pulse";
        els.mainIcon.innerHTML = `<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>`;
        els.slider.disabled = true;
        els.resetBtn.classList.add("opacity-50", "pointer-events-none"); 
    } else {
        // RESET STATE (Does not show "Complete" anymore, goes back to Ready)
        els.statusText.textContent = "Ready";
        els.statusDot.className = "w-2 h-2 rounded-full bg-brand-mid";
        els.mainIcon.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"></polygon>`;
        els.slider.disabled = false;
        els.resetBtn.classList.remove("opacity-50", "pointer-events-none");
    }
    els.taskName.textContent = state.currentTimerTaskName;
}

function updateStandbyUI() {
    if (state.timerRunning) {
        standbyEls.statusText.textContent = "Focusing";
        standbyEls.statusDot.className = "w-2 h-2 rounded-full bg-brand-mid animate-pulse";
        standbyEls.toggleIcon.innerHTML = `<rect x="6" y="4" width="4" height="16" fill="white"></rect><rect x="14" y="4" width="4" height="16" fill="white"></rect>`;
    } else {
        // RESET STATE
        standbyEls.statusText.textContent = "Ready";
        standbyEls.statusDot.className = "w-2 h-2 rounded-full bg-orange-500";
        standbyEls.toggleIcon.innerHTML = `<polygon points="5 3 19 12 5 21 5 3" fill="white"></polygon>`;
    }
    standbyEls.taskName.textContent = state.currentTimerTaskName;

    const totalSeconds = Math.ceil(state.currentTimerMs / 1000);
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    if (hrs > 0 || prevHours > 0) {
        document.getElementById('flip-group-hours').style.display = 'flex';
        document.getElementById('sep-1').style.display = 'block';
        updateFlipGroup('hours', hrs);
    } else {
        document.getElementById('flip-group-hours').style.display = 'none';
        document.getElementById('sep-1').style.display = 'none';
    }
    updateFlipGroup('minutes', mins);
    updateFlipGroup('seconds', secs);

    prevHours = hrs;
    prevMinutes = mins;
    prevSeconds = secs;
}

// --- FLIP CLOCK LOGIC ---
function createFlipClockStructure() {
    const createDigit = (id) => `
        <div class="flip-card" id="${id}">
            <div class="flip-card-inner">
                <div class="card-half top-half"><span>0</span></div>
                <div class="card-half bottom-half"><span>0</span></div>
                <div class="card-half top-half flip-leaf-top">
                    <span>0</span>
                    <div class="shadow-overlay"></div>
                </div>
                <div class="card-half bottom-half flip-leaf-bottom">
                    <span>0</span>
                    <div class="shadow-overlay"></div>
                </div>
            </div>
        </div>
    `;
    
    const separator = (id) => `<div id="${id}" class="text-6xl md:text-9xl font-mono text-white/20 px-2 flex items-center justify-center pb-4">:</div>`;

    standbyEls.clockContainer.innerHTML = `
        <div id="flip-group-hours" class="flex gap-2" style="display:none">
            ${createDigit('h-10')}
            ${createDigit('h-1')}
        </div>
        ${separator('sep-1')}
        <div id="flip-group-minutes" class="flex gap-2">
            ${createDigit('m-10')}
            ${createDigit('m-1')}
        </div>
        ${separator('sep-2')}
        <div id="flip-group-seconds" class="flex gap-2">
            ${createDigit('s-10')}
            ${createDigit('s-1')}
        </div>
    `;
}

function updateFlipGroup(unit, value) {
    const strVal = value.toString().padStart(2, '0');
    flipDigit(unit === 'hours' ? 'h-10' : unit === 'minutes' ? 'm-10' : 's-10', strVal[0]);
    flipDigit(unit === 'hours' ? 'h-1' : unit === 'minutes' ? 'm-1' : 's-1', strVal[1]);
}

function flipDigit(elementId, newValue) {
    const el = document.getElementById(elementId);
    if (!el) return;
    
    const topStatic = el.querySelector('.top-half:not(.flip-leaf-top) span');
    const bottomStatic = el.querySelector('.bottom-half:not(.flip-leaf-bottom) span');
    const topFlip = el.querySelector('.flip-leaf-top');
    const topFlipSpan = topFlip.querySelector('span');
    const bottomFlip = el.querySelector('.flip-leaf-bottom');
    const bottomFlipSpan = bottomFlip.querySelector('span');

    const currentValue = topStatic.innerText;
    if (currentValue === newValue) return;

    topStatic.innerText = newValue;
    bottomStatic.innerText = currentValue;
    topFlipSpan.innerText = currentValue;
    bottomFlipSpan.innerText = newValue;
    
    topFlip.classList.remove('flipping-top');
    bottomFlip.classList.remove('flipping-bottom');
    
    void topFlip.offsetWidth; 
    
    topFlip.classList.add('flipping-top');
    bottomFlip.classList.add('flipping-bottom');

    setTimeout(() => {
        topStatic.innerText = newValue;
        bottomStatic.innerText = newValue;
        topFlipSpan.innerText = newValue;
        bottomFlipSpan.innerText = newValue;
        
        topFlip.classList.remove('flipping-top');
        bottomFlip.classList.remove('flipping-bottom');
    }, 600);
}

// --- SHARED ACTIONS ---
async function toggleTimer() {
    if (state.timerEnded) { resetTimer(); return; }
    
    const now = Date.now();
    
    if (state.timerRunning) {
        state.pausedRemainingMs = state.timerEndTimestamp - now;
        state.timerRunning = false;
        
        const sessionTotal = state.timerValueState - state.pausedRemainingMs;
        const msToSave = sessionTotal - state.savedMsThisSession;
        if (msToSave > 1000) { await saveSessionStats(msToSave); state.savedMsThisSession += msToSave; }
    } else {
        state.timerEndTimestamp = now + state.pausedRemainingMs;
        state.timerRunning = true;
        state.lastSavedTotal = state.timerValueState - state.pausedRemainingMs;
    }
    pushStateToFirestore();
    updateUI();
}

function resetTimer() {
    state.timerRunning = false;
    state.timerEnded = false;
    const sliderVal = parseInt(els.slider.value) * 60000;
    state.timerValueState = sliderVal;
    state.pausedRemainingMs = sliderVal;
    state.currentTimerMs = sliderVal;
    state.savedMsThisSession = 0;
    state.lastSavedTotal = 0;
    pushStateToFirestore();
    updateUI();
}

// --- SUCCESS TOAST LOGIC ---
function showToast(message) {
    if (!els.toast || !els.toastMessage) return;
    els.toastMessage.textContent = message;
    
    // Show
    els.toast.classList.remove('opacity-0', '-translate-y-10');
    
    // Hide after 4 seconds
    setTimeout(() => {
        els.toast.classList.add('opacity-0', '-translate-y-10');
    }, 4000);
}

async function finishSessionGlobally() {
    if (state.finishInProgress) return;
    state.finishInProgress = true;
    
    // 1. Calculate focused time for the message
    // If we finished naturally (timer hit 0), it's the full duration.
    // If we clicked finish manually, it's the elapsed time.
    let focusedMinutes;
    const sessionTotal = state.timerValueState - state.currentTimerMs;
    
    if (state.currentTimerMs <= 1000) {
        // Natural finish: use full duration
        focusedMinutes = Math.round(state.timerValueState / 60000);
    } else {
        // Manual finish: use elapsed
        focusedMinutes = Math.round(sessionTotal / 60000);
    }

    // 2. Save Stats
    const msToSave = sessionTotal - state.savedMsThisSession;
    if (msToSave > 0) { await saveSessionStats(msToSave); state.savedMsThisSession += msToSave; }
    
    // 3. Show Success Message
    showToast(`Successfully focused for ${focusedMinutes} minutes.`);

    // 4. RESET TIMER STATE (Back to "Ready" with full time)
    state.timerRunning = false;
    state.timerEnded = false;
    state.currentTimerMs = state.timerValueState; // Reset to original duration
    state.pausedRemainingMs = state.timerValueState;
    state.savedMsThisSession = 0;
    
    state.finishInProgress = false;
    pushStateToFirestore();
    updateUI();
    if(isStandby) updateStandbyUI(); // Ensure standby clock snaps back to full time
}

async function saveSessionStats(msToAdd) {
    if (!uid || msToAdd <= 0) return;
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; 
    const dayRef = doc(db, `users/${uid}/weeklyFocus/${dateStr}`);
    const taskName = (state.currentTimerTaskName && state.currentTimerTaskName.trim() !== "") 
                      ? state.currentTimerTaskName : "Uncategorized";
    try {
        await setDoc(dayRef, {
            focusMs: increment(msToAdd),
            lastSessionMs: msToAdd,
            [`taskBreakdown.${taskName}`]: increment(msToAdd),
            updatedAt: serverTimestamp(),
        }, { merge: true });
    } catch (e) { console.error(e); }
}

async function enterStandby() {
    isStandby = true;
    standbyEls.overlay.classList.remove('hidden');
    standbyEls.overlay.classList.add('flex');
    try {
        if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
        else if (document.documentElement.webkitRequestFullscreen) await document.documentElement.webkitRequestFullscreen();
    } catch (e) {}
    if ('wakeLock' in navigator) {
        try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
    }
    resetControlsTimeout();
    updateStandbyUI();
}

async function exitStandby() {
    isStandby = false;
    standbyEls.overlay.classList.add('hidden');
    standbyEls.overlay.classList.remove('flex');
    if (document.fullscreenElement) try { await document.exitFullscreen(); } catch(e) {}
    if (wakeLock) { await wakeLock.release(); wakeLock = null; }
}

function resetControlsTimeout() {
    standbyEls.controls.style.opacity = '1';
    standbyEls.toggleBtn.style.opacity = '1';
    standbyEls.wrapper.style.cursor = 'default';
    if (controlsTimeout) clearTimeout(controlsTimeout);
    controlsTimeout = setTimeout(() => {
        if (isStandby && state.timerRunning) {
            standbyEls.controls.style.opacity = '0';
            standbyEls.toggleBtn.style.opacity = '0';
            standbyEls.wrapper.style.cursor = 'none';
        }
    }, 3000);
}

// Event Listeners
els.mainBtn.addEventListener('click', toggleTimer);
els.resetBtn.addEventListener('click', resetTimer);
els.finishBtn.addEventListener('click', () => { state.currentTimerMs = 0; finishSessionGlobally(); });
els.enterStandbyBtn.addEventListener('click', enterStandby);
standbyEls.toggleBtn.addEventListener('click', toggleTimer);
standbyEls.exitBtn.addEventListener('click', exitStandby);
standbyEls.finishBtn.addEventListener('click', () => { state.currentTimerMs = 0; finishSessionGlobally(); });
standbyEls.overlay.addEventListener('mousemove', resetControlsTimeout);
standbyEls.overlay.addEventListener('click', (e) => {
    if (e.target === standbyEls.overlay || e.target.closest('#flip-clock')) {
        if(e.target.closest('#flip-clock')) toggleTimer();
        resetControlsTimeout();
    }
});
standbyEls.overlay.addEventListener('dblclick', exitStandby);
document.addEventListener('keydown', (e) => {
    if (isStandby) {
        if (e.code === 'Space') { e.preventDefault(); toggleTimer(); resetControlsTimeout(); }
        if (e.code === 'Escape') exitStandby();
    }
});
document.getElementById('save-duration').addEventListener('click', () => {
    const newVal = parseInt(els.slider.value);
    if (!state.timerRunning) {
        state.timerValueState = newVal * 60000;
        state.pausedRemainingMs = newVal * 60000;
        state.currentTimerMs = newVal * 60000;
        state.savedMsThisSession = 0;
        pushStateToFirestore();
        updateUI();
    }
});
document.getElementById('task-container').addEventListener('click', () => {
    if(!state.timerRunning) {
        const newName = prompt("Enter Task Name:", state.currentTimerTaskName);
        if (newName && newName.trim() !== "") {
            state.currentTimerTaskName = newName.trim();
            pushStateToFirestore();
            updateUI();
        }
    }
});

// Start everything
init();