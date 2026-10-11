// Firebase project settings for the wiki.
//
// Copy the values from: Firebase console → Project settings → General →
// "Your apps" → Web app → SDK setup and configuration → Config.
// These values are NOT secret: access is protected by firestore.rules.
// See STAFF_SETUP.md for the full setup guide.
export const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Staff sessions are closed after this many minutes without activity.
export const IDLE_LOGOUT_MINUTES = 60;

// Local development only: when the site is opened from localhost with
// ?emulator=1 it talks to the Firebase emulators (firebase emulators:start).
export const EMULATOR_HOST = "127.0.0.1";

// Staff accounts sign in with "Role.Name" (e.g. Editor.Rapha), stored as
// "editor.rapha@<USERNAME_DOMAIN>". ".invalid" is a reserved domain that can
// never receive e-mail. Must match staffLoginRe() in firestore.rules.
export const USERNAME_DOMAIN = "dve-wiki.invalid";
