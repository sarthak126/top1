/* * USERNAME PICKER LOGIC MODULE
 * ------------------------------------------------------------------
 * Handles uniqueness checks via Firestore Transaction.
 * Redirects to authenticationL.html if user is not logged in.
 */

import { auth, db, isFirebaseReady, serverTimestamp } from "./firebase-init.js";
import { 
    doc, getDoc, runTransaction 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { 
    updateProfile, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const els = {
    input: document.getElementById('username-input'),
    status: document.getElementById('username-status'),
    icon: document.getElementById('username-icon'),
    submit: document.getElementById('username-submit'),
    error: document.getElementById('username-error')
};

let debounceTimer = null;
let currentNormalized = "";
let isAvailable = false;

// --- 1. SECURITY & REDIRECT CHECK ---
onAuthStateChanged(auth, (user) => {
    if (!user) {
        console.warn("No user found. Redirecting to login...");
        // If not logged in, go back to auth page
        window.location.href = "authenticationL.html";
    } else {
        // Optional: Check if they already have a username?
        // If so, maybe redirect to homepage immediately?
        // For now, we let them pick one if they are on this page.
        console.log("User authenticated:", user.uid);
    }
});

// --- 2. VALIDATION HELPERS ---
const isValidFormat = (s) => /^[a-z0-9_.-]{2,30}$/.test(s);

function setStatus(state, msg) {
    if (!els.status) return;
    els.icon.innerHTML = "";
    els.status.textContent = msg || "";
    els.status.className = "status-msg"; // reset

    if (state === 'checking') {
        els.status.textContent = "Checking...";
        els.status.classList.add('text-gray-500', 'dark:text-gray-400');
        els.icon.innerHTML = `<svg class="animate-spin h-4 w-4 text-brand-mid" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;
    } else if (state === 'available') {
        els.status.textContent = msg || "Available";
        els.status.classList.add('text-green-500');
        els.icon.innerHTML = `<svg class="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>`;
    } else if (state === 'taken' || state === 'error') {
        els.status.textContent = msg;
        els.status.classList.add('text-red-500');
        els.icon.innerHTML = `<svg class="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>`;
    }

    const canSubmit = (state === 'available') && (currentNormalized.length > 0);
    els.submit.disabled = !canSubmit;
    els.submit.classList.toggle('opacity-50', !canSubmit);
    els.submit.classList.toggle('cursor-not-allowed', !canSubmit);
}

// --- 3. CHECK AVAILABILITY ---
async function checkAvailability(val) {
    if (!val || !isFirebaseReady()) return;
    setStatus('checking');

    try {
        const docSnap = await getDoc(doc(db, "usernames", val));
        if (docSnap.exists()) {
            isAvailable = false;
            setStatus('taken', "Username taken");
        } else {
            isAvailable = true;
            setStatus('available', `@${val} is available`);
        }
    } catch (e) {
        console.error(e);
        setStatus('error', "Error checking availability");
    }
}

// --- 4. INPUT LISTENER ---
if (els.input) {
    els.input.addEventListener('input', (e) => {
        const raw = e.target.value;
        const normalized = raw.trim().toLowerCase().replace(/\s+/g, '');
        currentNormalized = normalized;
        isAvailable = false;
        
        if (debounceTimer) clearTimeout(debounceTimer);

        if (normalized.length === 0) {
            setStatus('default'); 
            return;
        }
        
        if (normalized.length < 2) return setStatus('error', "Too short");
        if (normalized.length > 30) return setStatus('error', "Too long");
        if (!isValidFormat(normalized)) return setStatus('error', "Only a-z, 0-9, . _ - allowed");

        debounceTimer = setTimeout(() => checkAvailability(normalized), 500);
    });

    els.input.addEventListener('keydown', (e) => {
        if(e.key === " ") e.preventDefault();
        if(e.key === 'Enter' && !els.submit.disabled) handleSubmit();
    });
}

// --- 5. SUBMIT HANDLER ---
async function handleSubmit() {
    if (!isAvailable || !auth.currentUser) return;
    
    // UI Loading
    els.submit.disabled = true;
    els.submit.innerHTML = `<span class="animate-pulse">Saving...</span>`;
    els.error.style.display = 'none';

    const uid = auth.currentUser.uid;
    const username = currentNormalized;
    const email = auth.currentUser.email;

    try {
        await runTransaction(db, async (t) => {
            const usernameRef = doc(db, "usernames", username);
            const taken = await t.get(usernameRef);
            if (taken.exists()) throw "taken";

            const userRef = doc(db, "users", uid);
            const clubRef = doc(db, "top1club", uid);

            // Reserve
            t.set(usernameRef, { uid, createdAt: serverTimestamp() });
            
            // Update User
            t.set(userRef, { 
                username, 
                display_name: username, 
                email, 
                uid,
                updatedAt: serverTimestamp() 
            }, { merge: true });
            
            // Leaderboard
            t.set(clubRef, { uid, username, createdAt: serverTimestamp() }, { merge: true });
        });

        // Update Auth Profile
        await updateProfile(auth.currentUser, { displayName: username });
        
        els.submit.textContent = "Success!";
        
        // REDIRECT TO HOME
        setTimeout(() => {
            window.location.href = "index.html"; // Or homepage.html
        }, 1000);

    } catch (err) {
        console.error(err);
        els.submit.textContent = "Continue";
        els.submit.disabled = false;
        els.submit.classList.remove('opacity-50', 'cursor-not-allowed');
        
        if (err === "taken") {
            isAvailable = false;
            setStatus('taken', "Someone just took this username.");
        } else {
            els.error.textContent = "Transaction failed. Please try again.";
            els.error.style.display = 'block';
        }
    }
}

if (els.submit) els.submit.addEventListener('click', handleSubmit);