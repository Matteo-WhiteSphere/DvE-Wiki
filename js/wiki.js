// Core module shared by the dynamic wiki pages and the staff area:
// Firebase initialisation, session/role handling, safe Markdown rendering.
import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
    getAuth, connectAuthEmulator, onAuthStateChanged, signOut, inMemoryPersistence,
    setPersistence, createUserWithEmailAndPassword, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
    getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc,
    collection, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { marked } from './vendor/marked.esm.js';
import DOMPurify from './vendor/purify.es.js';
import { firebaseConfig, IDLE_LOGOUT_MINUTES, EMULATOR_HOST, USERNAME_DOMAIN } from './firebase-config.js';

// ------------------------------------------------------------------ setup

const isLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname);
if (isLocalhost && new URLSearchParams(location.search).get('emulator') === '1') {
    sessionStorage.setItem('dve_emulator', '1');
}
export const usingEmulator = isLocalhost && sessionStorage.getItem('dve_emulator') === '1';

const activeConfig = usingEmulator
    ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-dve', appId: 'demo-app' }
    : firebaseConfig;

export const isConfigured = usingEmulator ||
    (!!firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('YOUR_') &&
     !firebaseConfig.projectId.startsWith('YOUR_'));

export let app = null, auth = null, db = null;
if (isConfigured) {
    app = initializeApp(activeConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    if (usingEmulator) {
        connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
        connectFirestoreEmulator(db, EMULATOR_HOST, 8080);
    }
}

// ------------------------------------------------------------------ roles

export const ROLES = ['owner', 'admin', 'editor', 'user', 'disabled'];
export const isEditorRole = (r) => r === 'editor' || r === 'admin' || r === 'owner';
export const isAdminRole = (r) => r === 'admin' || r === 'owner';

/** Roles that a user with role `actor` may grant (mirrors canAssign() in firestore.rules). */
export function assignableRoles(actor) {
    if (actor === 'owner') return ['user', 'editor', 'admin', 'disabled'];
    if (actor === 'admin') return ['user', 'editor', 'disabled'];
    return [];
}

// ------------------------------------------------------ staff usernames
// Staff accounts log in with "Role.Name" (e.g. Editor.Rapha). Internally they are
// e-mail/password accounts on a reserved domain that can never receive mail.

export const ROLE_PREFIX = { owner: 'Owner', admin: 'Admin', editor: 'Editor' };
export const STAFF_NAME_RE = /^[A-Za-z0-9_-]{2,32}$/;
const STAFF_USERNAME_RE = /^(owner|admin|editor)\.[a-z0-9_-]{2,32}$/i;

export function staffUsername(role, name) {
    return `${ROLE_PREFIX[role]}.${name}`;
}

/** "Editor.Rapha" → "editor.rapha@<domain>"; a real e-mail address is returned lower-cased. */
export function loginToEmail(login) {
    const value = String(login || '').trim();
    if (value.includes('@')) return value.toLowerCase();
    if (!STAFF_USERNAME_RE.test(value)) return null;
    return `${value.toLowerCase()}@${USERNAME_DOMAIN}`;
}

export function isStaffEmail(email) {
    return String(email || '').toLowerCase().endsWith('@' + USERNAME_DOMAIN);
}

/** What to show for an account: its "Role.Name" or its e-mail address. */
export function accountLabel(profile, user) {
    const email = (profile && profile.email) || (user && user.email) || '';
    if (isStaffEmail(email)) return (profile && profile.displayName) || email.split('@')[0];
    return email;
}

/** Random temporary password that satisfies the Firebase password policy. */
export function tempPassword() {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ', lower = 'abcdefghijkmnopqrstuvwxyz', digits = '23456789';
    const all = upper + lower + digits;
    const bytes = crypto.getRandomValues(new Uint32Array(16));
    const chars = [...bytes].map((b, i) => {
        const set = i === 0 ? upper : i === 1 ? lower : i === 2 ? digits : all;
        return set[b % set.length];
    });
    return chars.join('').match(/.{4}/g).join('-');
}

// ---------------------------------------------------------------- session

/**
 * Makes sure the signed-in user has a profile document. New users are created
 * with role "user" unless an admin invited their (verified) e-mail address.
 */
async function ensureProfile(user) {
    const ref = doc(db, 'users', user.uid);
    let snap = await getDoc(ref);
    const email = (user.email || '').toLowerCase();
    const profile = snap.exists() ? snap.data() : null;

    let invite = null;
    if (email && user.emailVerified && (!profile || profile.role === 'user')) {
        await user.getIdToken(true); // make sure the token carries email_verified
        try {
            const inv = await getDoc(doc(db, 'invites', email));
            if (inv.exists()) invite = inv.data();
        } catch (e) { /* no invite readable */ }
    }

    if (!profile) {
        await setDoc(ref, {
            email,
            displayName: (user.displayName || email.split('@')[0] || 'user').slice(0, 80),
            role: invite ? invite.role : 'user',
            createdAt: serverTimestamp(),
            lastLogin: serverTimestamp()
        });
        if (invite) await deleteDoc(doc(db, 'invites', email)).catch(() => {});
    } else if (profile.role === 'user' && invite) {
        await updateDoc(ref, { role: invite.role, lastLogin: serverTimestamp() });
        await deleteDoc(doc(db, 'invites', email)).catch(() => {});
    } else {
        const last = profile.lastLogin && profile.lastLogin.toMillis ? profile.lastLogin.toMillis() : 0;
        if (Date.now() - last > 30 * 60 * 1000) {
            await updateDoc(ref, { lastLogin: serverTimestamp() }).catch(() => {});
        }
    }
    snap = await getDoc(ref);
    return snap.data();
}

/**
 * Calls cb({ user, profile, role }) whenever the session changes.
 * user is null when signed out. role is 'none' when signed out.
 */
export function watchSession(cb) {
    if (!isConfigured) { cb({ user: null, profile: null, role: 'none' }); return () => {}; }
    return onAuthStateChanged(auth, async (user) => {
        if (!user) { cb({ user: null, profile: null, role: 'none' }); return; }
        try {
            const profile = await ensureProfile(user);
            cb({ user, profile, role: profile ? profile.role : 'user' });
        } catch (e) {
            console.error('Profile error', e);
            cb({ user, profile: null, role: 'user', error: e });
        }
    });
}

/** Verified address (or staff login) and no pending temporary password: mirrors active() in the rules. */
export function accountActive(user, profile) {
    if (!user || !profile || profile.mustChangePassword) return false;
    return user.emailVerified || isStaffEmail(user.email);
}

export async function logout() {
    localStorage.removeItem('dve_last_activity');
    if (auth) await signOut(auth);
}

/** Signs staff out after IDLE_LOGOUT_MINUTES without activity (shared across tabs). */
export function enforceIdleTimeout() {
    const KEY = 'dve_last_activity';
    const limit = IDLE_LOGOUT_MINUTES * 60 * 1000;
    const read = () => { try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; } };
    const touch = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ } };

    const check = async () => {
        const last = read();
        if (auth && auth.currentUser && last && Date.now() - last > limit) {
            await logout();
            location.href = 'login.html?expired=1&next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search);
        }
    };
    check().then(touch);
    let lastTouch = Date.now();
    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach((ev) =>
        addEventListener(ev, () => {
            if (Date.now() - lastTouch > 15000) { lastTouch = Date.now(); touch(); }
        }, { passive: true }));
    setInterval(check, 60 * 1000);
}

/**
 * Creates an e-mail/password account for someone else without signing the
 * current admin out (uses a throw-away secondary Firebase app), then sends
 * a password-reset e-mail so the new user chooses their own password.
 */
async function withSecondaryAuth(fn) {
    const secondary = initializeApp(activeConfig, 'secondary-' + Date.now());
    try {
        const secAuth = getAuth(secondary);
        if (usingEmulator) connectAuthEmulator(secAuth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
        await setPersistence(secAuth, inMemoryPersistence);
        const result = await fn(secAuth);
        await signOut(secAuth).catch(() => {});
        return result;
    } finally {
        await deleteApp(secondary).catch(() => {});
    }
}

export async function createPasswordAccount(email) {
    const created = await withSecondaryAuth(async (secAuth) => {
        try {
            const bytes = crypto.getRandomValues(new Uint8Array(24));
            await createUserWithEmailAndPassword(secAuth, email, btoa(String.fromCharCode(...bytes)) + 'aA1!');
            return true;
        } catch (e) {
            if (e.code !== 'auth/email-already-in-use') throw e;
            return false;
        }
    });
    await sendPasswordResetEmail(auth, email);
    return { created };
}

/**
 * Creates a "Role.Name" staff login with a temporary password (shown once to the
 * admin, who passes it on). Returns { uid, email, password }.
 */
export async function createStaffLogin(username) {
    const email = loginToEmail(username);
    if (!email) throw new Error('Invalid username.');
    const password = tempPassword();
    const uid = await withSecondaryAuth(async (secAuth) => {
        const cred = await createUserWithEmailAndPassword(secAuth, email, password);
        return cred.user.uid;
    });
    return { uid, email, password };
}

/** Builds an audit-log document (to be written in a batch/transaction or alone). */
export function auditEntry(user, action, target, details = '') {
    return {
        ref: doc(collection(db, 'audit')),
        data: {
            action: String(action).slice(0, 40),
            target: String(target).slice(0, 200),
            details: String(details).slice(0, 500),
            actor: user.uid,
            actorEmail: (user.email || '').toLowerCase(),
            at: serverTimestamp()
        }
    };
}

export async function logAudit(user, action, target, details = '') {
    const e = auditEntry(user, action, target, details);
    await setDoc(e.ref, e.data);
}

// ---------------------------------------------------------- placeholders

let seedCache = null;
/** The old static placeholder pages, kept as starting drafts (data/placeholders.json). */
export async function loadSeeds() {
    if (!seedCache) {
        try {
            const res = await fetch('data/placeholders.json', { cache: 'no-cache' });
            seedCache = res.ok ? await res.json() : {};
        } catch { seedCache = {}; }
    }
    return seedCache;
}

// --------------------------------------------------------------- helpers

export const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function slugify(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9_-]+/g, '_').replace(/^[_-]+|[_-]+$/g, '').slice(0, 64);
}

export function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
        if (c === null || c === undefined || c === false) continue;
        node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
}

export function hexToRgba(hex, alpha) {
    if (!COLOR_RE.test(hex)) return `rgba(0, 243, 255, ${alpha})`;
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function applyAccent(target, hex) {
    const color = COLOR_RE.test(hex || '') ? hex : '#00f3ff';
    target.style.setProperty('--accent-color', color);
    target.style.setProperty('--accent-glow', hexToRgba(color, 0.35));
}

export function formatDate(ts) {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString();
}

export function friendlyError(e) {
    const code = (e && e.code) || '';
    const map = {
        'auth/invalid-credential': 'Wrong username / e-mail or password.',
        'auth/wrong-password': 'Wrong username / e-mail or password.',
        'auth/user-not-found': 'Wrong username / e-mail or password.',
        'auth/invalid-email': 'Invalid username or e-mail address.',
        'auth/email-already-in-use': 'This username or e-mail address is already taken.',
        'auth/weak-password': 'The password is too weak (at least 10 characters, with upper-case, lower-case letters and a number).',
        'auth/password-does-not-meet-requirements': 'The password does not meet the requirements (at least 10 characters, with upper-case, lower-case letters and a number).',
        'auth/requires-recent-login': 'For security, sign out and sign in again, then retry.',
        'auth/too-many-requests': 'Too many attempts. The account is temporarily locked, try again later or reset the password.',
        'auth/user-disabled': 'This account has been disabled.',
        'auth/popup-closed-by-user': 'Login window closed.',
        'auth/popup-blocked': 'The browser blocked the login popup. Allow popups for this site.',
        'auth/network-request-failed': 'Network error. Check your connection.',
        'auth/unauthorized-domain': 'This domain is not authorized in Firebase (Authentication → Settings → Authorized domains).',
        'permission-denied': 'Permission denied: your account does not have the required role.',
        'unavailable': 'Database unreachable. Check your connection.'
    };
    return map[code] || (e && e.message) || String(e);
}

// ------------------------------------------------------------- markdown

const ALLOWED_STYLE_PROPS = new Set([
    'color', 'background-color', 'border-color', 'font-weight', 'font-style',
    'text-align', 'text-decoration', 'text-transform'
]);
const SAFE_STYLE_VALUE = /^[#a-z0-9 ,.%()-]+$/i;

DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName !== 'style') return;
    const kept = [];
    for (const decl of data.attrValue.split(';')) {
        const i = decl.indexOf(':');
        if (i < 0) continue;
        const prop = decl.slice(0, i).trim().toLowerCase();
        const value = decl.slice(i + 1).trim();
        if (ALLOWED_STYLE_PROPS.has(prop) && SAFE_STYLE_VALUE.test(value) && !/url|expression|var/i.test(value)) {
            kept.push(`${prop}: ${value}`);
        }
    }
    if (kept.length) data.attrValue = kept.join('; ');
    else data.keepAttr = false;
});

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
        const href = node.getAttribute('href');
        if (/^https?:\/\//i.test(href) && !href.startsWith(location.origin)) {
            node.setAttribute('target', '_blank');
            node.setAttribute('rel', 'noopener noreferrer nofollow');
        }
    }
    if (node.tagName === 'IMG') node.setAttribute('loading', 'lazy');
});

const PURIFY_OPTS = {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'script', 'form', 'input', 'button', 'textarea', 'select', 'option',
                  'iframe', 'frame', 'object', 'embed', 'link', 'meta', 'base', 'svg', 'math'],
    FORBID_ATTR: ['id', 'srcset', 'formaction', 'autofocus'],
    ALLOW_DATA_ATTR: false
};

/** Markdown (GitHub flavour, tables included) → sanitized HTML string. */
export function renderMarkdown(md) {
    const raw = marked.parse(String(md || ''), { gfm: true, breaks: false, async: false });
    const clean = DOMPurify.sanitize(raw, PURIFY_OPTS);
    const tpl = document.createElement('template');
    tpl.innerHTML = clean;
    tpl.content.querySelectorAll('table').forEach((t) => {
        t.classList.add('wiki-table');
        const wrap = document.createElement('div');
        wrap.className = 'table-wrap';
        t.replaceWith(wrap);
        wrap.append(t);
    });
    tpl.content.querySelectorAll('img').forEach((img) => {
        if (img.closest('a')) return;
        const a = document.createElement('a');
        a.href = img.getAttribute('src') || '#';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        img.replaceWith(a);
        a.append(img);
    });
    return tpl.innerHTML;
}

/** Renders the sections of a page into `container`. */
export function renderSections(container, sections) {
    container.replaceChildren();
    let grid = null;
    for (const s of sections || []) {
        const layout = ['half', 'third'].includes(s.layout) ? s.layout : 'full';
        const card = el('div', { class: 'card layout-' + layout });
        if (s.title) card.append(el('h3', { text: s.title }));
        const body = el('div', { class: 'card-body' });
        body.innerHTML = renderMarkdown(s.body);
        card.append(body);
        if (layout === 'full') {
            grid = null;
            container.append(card);
        } else {
            if (!grid) { grid = el('div', { class: 'grid' }); container.append(grid); }
            grid.append(card);
        }
    }
}

/** Fills the standard header (h1 + subtitle) and applies the accent colour. */
export function renderHeader(headerEl, page) {
    headerEl.replaceChildren(
        el('h1', { text: page.title || 'Untitled' }),
        page.subtitle ? el('p', { text: page.subtitle }) : ''
    );
    applyAccent(document.documentElement, page.accent);
}
