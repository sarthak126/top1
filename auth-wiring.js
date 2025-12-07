/* * AUTH WIRING MODULE
 * ------------------------------------------------------------------
 * Handles Login, Signup, Google Auth.
 * LOGIC:
 * - Signup Success -> FORCE redirect to username.html
 * - Login Success -> Check DB: if username exists -> Home, else -> Username.html
 */

import { auth, db, isFirebaseReady, serverTimestamp } from "./firebase-init.js";
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    onAuthStateChanged,
    GoogleAuthProvider,
    signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    doc, setDoc, getDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// DOM Elements
const els = {
    sForm: document.getElementById('signup-form'),
    lForm: document.getElementById('login-form'),
    sName: document.getElementById('signup-name'),
    sEmail: document.getElementById('signup-email'),
    sPass: document.getElementById('signup-password'),
    sConfirm: document.getElementById('signup-confirm'),
    sSubmit: document.getElementById('signup-submit'),
    sGoogle: document.getElementById('google-signup'),
    sError: document.getElementById('signup-error'),
    lEmail: document.getElementById('login-email'),
    lPass: document.getElementById('login-password'),
    lSubmit: document.getElementById('login-submit'),
    lGoogle: document.getElementById('google-signin'),
    lError: document.getElementById('login-error'),
    gError: document.getElementById('auth-error')
};

// --- Helpers ---

function getActiveContext() {
    if (document.getElementById('login-view')?.classList.contains('active')) return 'login';
    if (document.getElementById('signup-view')?.classList.contains('active')) return 'signup';
    return 'general';
}

function showMessage(type, text, contextOverride = null) {
    const context = contextOverride || getActiveContext();
    let targetEl;

    if (context === 'signup') targetEl = els.sError;
    else if (context === 'login') targetEl = els.lError;
    else targetEl = els.gError;

    if (!targetEl || targetEl.offsetParent === null) targetEl = els.gError;

    if (targetEl) {
        targetEl.textContent = text;
        targetEl.style.display = 'block';
        if (type === 'success') {
            targetEl.style.color = '#22c55e'; 
            targetEl.style.backgroundColor = 'rgba(34, 197, 94, 0.1)';
        } else {
            targetEl.style.color = '#ef4444';
            targetEl.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
        }
    } else {
        alert(text);
    }
}

function setLoading(btn, isLoading, defaultText) {
    if (!btn) return;
    if (isLoading) {
        if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent;
        btn.disabled = true;
        btn.innerHTML = `<span class="animate-pulse">Processing...</span>`;
        btn.classList.add('opacity-75', 'cursor-not-allowed');
    } else {
        btn.disabled = false;
        btn.textContent = defaultText || btn.dataset.originalText || "Submit";
        btn.classList.remove('opacity-75', 'cursor-not-allowed');
    }
}

function getFriendlyError(error) {
    if (!error || !error.code) return error?.message || "An unknown error occurred.";
    const code = error.code;
    const errors = {
        'auth/email-already-in-use': 'This email is already registered. Please login.',
        'auth/invalid-email': 'Please enter a valid email address.',
        'auth/user-not-found': 'No account found with this email.',
        'auth/wrong-password': 'Incorrect password.',
        'auth/weak-password': 'Password should be at least 6 characters.',
        'auth/popup-closed-by-user': 'Sign in popup was closed.',
        'auth/network-request-failed': 'Network error. Check your connection.',
        'auth/unauthorized-domain': 'Domain not authorized. Add in Firebase Console -> Auth.'
    };
    return errors[code] || `Error: ${code}`;
}

// --- Flows ---

// 1. SIGNUP (New Account -> Username Page)
async function handleSignup(e) {
    if(e) e.preventDefault();
    const name = els.sName?.value.trim();
    const email = els.sEmail?.value.trim();
    const pass = els.sPass?.value;
    const confirm = els.sConfirm?.value;

    if (!name || !email || !pass) return showMessage('error', 'Please fill in all fields.', 'signup');
    if (pass.length < 6) return showMessage('error', 'Password must be 6+ chars.', 'signup');
    if (pass !== confirm) return showMessage('error', 'Passwords do not match.', 'signup');

    setLoading(els.sSubmit, true, "Create Account");

    try {
        // A. Create Account
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        
        // B. Create Database Entry (username is null)
        await setDoc(doc(db, "users", cred.user.uid), {
            email: email,
            display_name: name,
            created_time: serverTimestamp(),
            username: null,
            onboarding_complete: false
        }, { merge: true });

        console.log("Signup Success -> Redirecting to Username Setup");
        
        // C. FORCE REDIRECT TO USERNAME PAGE (New User)
        window.location.href = "username.html";

    } catch (error) {
        console.error("Signup Error:", error);
        showMessage('error', getFriendlyError(error), 'signup');
    } finally {
        setLoading(els.sSubmit, false, "Create Account");
    }
}

// 2. LOGIN (Existing Account -> Check Status)
async function handleLogin(e) {
    if(e) e.preventDefault();
    const email = els.lEmail?.value.trim();
    const pass = els.lPass?.value;

    if (!email || !pass) return showMessage('error', 'Please enter email and password.', 'login');
    setLoading(els.lSubmit, true, "Sign In");

    try {
        const cred = await signInWithEmailAndPassword(auth, email, pass);
        console.log("Login Success -> Checking Profile...");
        
        // Check if they have a username set up
        checkUserStatusAndRedirect(cred.user);

    } catch (error) {
        console.error("Login Error:", error);
        showMessage('error', getFriendlyError(error), 'login');
    } finally {
        setLoading(els.lSubmit, false, "Sign In");
    }
}

// 3. GOOGLE (Could be New OR Existing -> Check Status)
const handleGoogleAuth = async (context) => {
    if (!isFirebaseReady()) return alert("Firebase loading...");
    const provider = new GoogleAuthProvider();
    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        
        // Ensure doc exists if it's a new Google user
        const userRef = doc(db, "users", user.uid);
        const snap = await getDoc(userRef);
        if (!snap.exists()) {
            await setDoc(userRef, {
                email: user.email,
                display_name: user.displayName || "User",
                created_time: serverTimestamp(),
                username: null,
                onboarding_complete: false
            });
        }
        
        // Check routing (New -> Username, Existing -> Home)
        checkUserStatusAndRedirect(user);

    } catch (error) {
        console.error("Google Auth:", error);
        showMessage('error', getFriendlyError(error), context);
    }
};

// --- Routing Helper ---
async function checkUserStatusAndRedirect(user) {
    if (!isFirebaseReady()) return;
    try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const data = snap.data();
        
        // If they have a username, go Home. If not, go to Username page.
        if (data && data.username) {
            console.log("✅ Existing User -> Homepage");
            if (!window.location.href.includes('homepage.html')) {
                window.location.href = "homepage.html"; // Modify this URL if your homepage file is named differently
            }
        } else {
            console.log("⚠️ Incomplete Profile -> Username Page");
            if (!window.location.href.includes('username.html')) {
                window.location.href = "username.html"; 
            }
        }
    } catch (e) {
        console.error("Routing error:", e);
    }
}

// Listeners
if (els.sForm) els.sForm.addEventListener('submit', handleSignup);
if (els.lForm) els.lForm.addEventListener('submit', handleLogin);
if (els.sGoogle) els.sGoogle.addEventListener('click', () => handleGoogleAuth('signup'));
if (els.lGoogle) els.lGoogle.addEventListener('click', () => handleGoogleAuth('login'));

// Auth State Listener (Handles page refreshes)
onAuthStateChanged(auth, (user) => {
    if (user) {
        // If user is logged in, verify they are on the right page
        if (!window.location.href.includes('homepage.html') && !window.location.href.includes('username.html')) {
             checkUserStatusAndRedirect(user);
        }
    } 
});