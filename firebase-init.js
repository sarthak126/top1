/* * FIREBASE INITIALIZATION MODULE
 * ------------------------------------------------------------------
 * Handles App, Auth, Firestore init and exports readiness check.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, 
    enableIndexedDbPersistence,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyA6SeNSU6msvU890bucTO463kmyeOE7rDI",
  authDomain: "habit-streak-tracker-j2zli2.firebaseapp.com",
  projectId: "habit-streak-tracker-j2zli2",
  storageBucket: "habit-streak-tracker-j2zli2.firebasestorage.app",
  messagingSenderId: "842193529900",
  appId: "1:842193529900:web:2c7f052531c11b51f67589"
};

// Initialize
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Persistence (Optional - Silent Fail)
enableIndexedDbPersistence(db).catch((err) => {
    console.debug("Persistence disabled:", err.code);
});

// Readiness Flag
let _ready = true; // Sync init usually ready immediately, but good for pattern
function isFirebaseReady() { return _ready && !!auth && !!db; }

// Debug Helper
window.checkInit = () => {
    console.log(`Firebase Init: ${isFirebaseReady() ? 'OK' : 'FAIL'}`);
    console.log(`Project: ${firebaseConfig.projectId}`);
};

export { app, auth, db, isFirebaseReady, serverTimestamp };

/* How to test firebase-init.js:
   1. Open console.
   2. Type `checkInit()`.
   3. Should see "Firebase Init: OK".
*/