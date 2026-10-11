// Server core for the DvE wiki: storage (Netlify Blobs), passwords, sessions,
// roles and validation. Used by netlify/functions/api.mjs.
import { getStore } from '@netlify/blobs';
import { scrypt, randomBytes, randomInt, createHmac, timingSafeEqual } from 'node:crypto';
import staffList from '../../data/staff-accounts.json' with { type: 'json' };

// ----------------------------------------------------------------- storage

const stores = {};
export function store(name) {
    // Strong consistency: a write is visible to the very next read (logins, roles, pages).
    return (stores[name] ||= getStore({ name, consistency: 'strong' }));
}

// --------------------------------------------------------------- constants

export const SESSION_COOKIE = '__Host-dve_session';
export const IDLE_MINUTES = 60;          // session ends after 60 minutes without activity
export const MAX_SESSION_HOURS = 12;     // and in any case after 12 hours
export const MAX_FAILED_LOGINS = 5;      // per account, then locked for LOCK_MINUTES
export const MAX_IP_ATTEMPTS = 30;       // per IP address in LOCK_MINUTES
export const LOCK_MINUTES = 15;

export const ROLES = ['owner', 'admin', 'editor', 'disabled'];
export const ROLE_PREFIX = { owner: 'Owner', admin: 'Admin', editor: 'Editor' };
export const USERNAME_RE = /^(owner|admin|editor)\.([a-z0-9_-]{2,32})$/i;

// Which roles a user can create, and which roles they can manage (change / reset).
// Existing owners can never be changed from the website.
const CAN_CREATE = { owner: ['owner', 'admin', 'editor'], admin: ['editor'] };
const CAN_MANAGE = { owner: ['admin', 'editor', 'disabled'], admin: ['editor', 'disabled'] };

export const isEditorRole = (r) => r === 'editor' || r === 'admin' || r === 'owner';
export const isAdminRole = (r) => r === 'admin' || r === 'owner';
export const canCreate = (actor, role) => (CAN_CREATE[actor] || []).includes(role);
export const canManage = (actor, target) => (CAN_MANAGE[actor] || []).includes(target.role);
export const canAssign = (actor, role) => (CAN_MANAGE[actor] || []).includes(role);

export class HttpError extends Error {
    constructor(status, message, extra = {}) {
        super(message);
        this.status = status;
        this.extra = extra;
    }
}

// --------------------------------------------------------------- usernames

/** "Editor.Rapha" → { role: 'editor', name: 'Rapha', key: 'rapha', username: 'Editor.Rapha' } */
export function parseUsername(value) {
    const m = String(value || '').trim().match(USERNAME_RE);
    if (!m) return null;
    const role = m[1].toLowerCase();
    return { role, name: m[2], key: m[2].toLowerCase(), username: `${ROLE_PREFIX[role]}.${m[2]}` };
}

export function renameForRole(username, role) {
    if (!ROLE_PREFIX[role]) return username; // disabled accounts keep their login
    return `${ROLE_PREFIX[role]}.${username.split('.').slice(1).join('.')}`;
}

// --------------------------------------------------------------- passwords

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scryptAsync(password, salt) {
    return new Promise((resolve, reject) =>
        scrypt(password, salt, 32, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(password) {
    const salt = randomBytes(16);
    const hash = await scryptAsync(password, salt);
    return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

const DUMMY_HASH = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

/** Constant-time check. Pass null as stored hash to burn the same time for unknown users. */
export async function verifyPassword(password, stored) {
    const [, , , , saltB64, hashB64] = (stored || DUMMY_HASH).split('$');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = await scryptAsync(String(password || ''), Buffer.from(saltB64, 'base64'));
    return !!stored && actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function passwordProblem(pw) {
    if (typeof pw !== 'string' || pw.length < 10) return 'The password must be at least 10 characters long.';
    if (pw.length > 200) return 'The password is too long.';
    if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw)) {
        return 'The password needs upper-case and lower-case letters and a number.';
    }
    return null;
}

/** Random temporary password, e.g. "Hb2g-upNa-3uPJ-cfWa". */
export function tempPassword() {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ', lower = 'abcdefghijkmnopqrstuvwxyz', digits = '23456789';
    const all = upper + lower + digits;
    const chars = Array.from({ length: 16 }, (_, i) => {
        const set = i === 0 ? upper : i === 1 ? lower : i === 2 ? digits : all;
        return set[randomInt(set.length)];
    });
    return chars.join('').match(/.{4}/g).join('-');
}

// ---------------------------------------------------------------- sessions

let secretCache = null;
async function sessionSecret() {
    if (secretCache) return secretCache;
    if (process.env.DVE_SESSION_SECRET && process.env.DVE_SESSION_SECRET.length >= 32) {
        return (secretCache = process.env.DVE_SESSION_SECRET);
    }
    // Generated once and kept in the private server-side store.
    const meta = store('meta');
    await meta.set('session-secret', randomBytes(48).toString('base64'), { onlyIfNew: true });
    return (secretCache = await meta.get('session-secret'));
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export async function signSession(user, issuedAt = Date.now()) {
    const payload = b64url(JSON.stringify({
        k: user.key, v: user.sessionVersion, iat: issuedAt, exp: Date.now() + IDLE_MINUTES * 60000
    }));
    const sig = b64url(createHmac('sha256', await sessionSecret()).update(payload).digest());
    return `${payload}.${sig}`;
}

export async function readSession(token) {
    if (!token || typeof token !== 'string' || token.length > 1000) return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = createHmac('sha256', await sessionSecret()).update(payload).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    let data;
    try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
    const now = Date.now();
    if (!data || data.exp < now || data.iat + MAX_SESSION_HOURS * 3600000 < now) return null;
    const user = await getUser(data.k);
    if (!user || user.role === 'disabled' || user.sessionVersion !== data.v) return null;
    return { user, issuedAt: data.iat };
}

export function sessionCookie(token, maxAgeSeconds = IDLE_MINUTES * 60) {
    return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

// ------------------------------------------------------------------- users

export async function getUser(key) {
    if (!key) return null;
    return store('users').get(String(key).toLowerCase(), { type: 'json' });
}

export async function listUsers() {
    const { blobs } = await store('users').list();
    const users = await Promise.all(blobs.map((b) => store('users').get(b.key, { type: 'json' })));
    return users.filter(Boolean);
}

export async function saveUser(user) {
    await store('users').setJSON(user.key, user);
}

/** Creates a "Role.Name" account with a temporary password. Returns the password, or null if the name is taken. */
export async function createUser(username, createdBy) {
    const parsed = parseUsername(username);
    if (!parsed) throw new HttpError(400, `"${username}" is not a valid username (Owner.Name, Admin.Name or Editor.Name).`);
    const password = tempPassword();
    const user = {
        key: parsed.key,
        username: parsed.username,
        role: parsed.role,
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
        sessionVersion: 1,
        createdAt: new Date().toISOString(),
        createdBy,
        lastLogin: null
    };
    const res = await store('users').setJSON(parsed.key, user, { onlyIfNew: true });
    if (res && res.modified === false) return null;
    return { user, password };
}

export function publicUser(u) {
    return {
        username: u.username, role: u.role, mustChangePassword: !!u.mustChangePassword,
        createdAt: u.createdAt, createdBy: u.createdBy, lastLogin: u.lastLogin
    };
}

// ------------------------------------------------------- staff accounts file

const HASH_RE = /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/;

/**
 * Applies data/staff-accounts.json: every entry is
 *   { "username": "Editor.Rapha", "tempPassword": "scrypt$…", "reset": "<id>" }
 * where tempPassword is the HASH of a temporary password (never the password itself:
 * the repository is public). Missing accounts are created; an existing account gets
 * that temporary password once for every new "reset" id. Either way the password
 * must be changed at the next login.
 */
export async function syncStaffAccounts(entries) {
    const users = store('users');
    const results = [];
    for (const entry of entries || []) {
        const parsed = parseUsername(entry && entry.username);
        if (!parsed || !HASH_RE.test(entry.tempPassword || '') || !entry.reset) continue;
        const current = await users.getWithMetadata(parsed.key, { type: 'json' });
        const user = current && current.data;
        if (!user) {
            const fresh = {
                key: parsed.key, username: parsed.username, role: parsed.role,
                passwordHash: entry.tempPassword, mustChangePassword: true, sessionVersion: 1,
                appliedReset: String(entry.reset), createdAt: new Date().toISOString(),
                createdBy: 'staff-accounts.json', lastLogin: null
            };
            const res = await users.setJSON(parsed.key, fresh, { onlyIfNew: true });
            if (!res || res.modified !== false) {
                await audit('staff-accounts.json', 'account.create', parsed.username, parsed.role);
                results.push({ username: parsed.username, action: 'created' });
            }
        } else if (user.appliedReset !== String(entry.reset)) {
            const updated = {
                ...user, passwordHash: entry.tempPassword, mustChangePassword: true,
                sessionVersion: user.sessionVersion + 1, appliedReset: String(entry.reset)
            };
            // Only if nobody changed the account meanwhile (e.g. a login on another server).
            const res = await users.setJSON(parsed.key, updated, { onlyIfMatch: current.etag });
            if (!res || res.modified !== false) {
                await clearFailures('user', parsed.key);
                await audit('staff-accounts.json', 'account.reset', user.username, 'temporary password from file');
                results.push({ username: user.username, action: 'reset' });
            }
        }
    }
    return results;
}

let synced = false;
/** Runs the staff-accounts file sync once per server instance. */
export async function ensureBootstrap() {
    if (synced) return;
    await syncStaffAccounts(staffList.accounts);
    synced = true;
}

// ------------------------------------------------------------- rate limits

export async function checkLock(kind, id) {
    const entry = await store('ratelimit').get(`${kind}:${id}`, { type: 'json' });
    if (entry && entry.until && entry.until > Date.now()) {
        const minutes = Math.ceil((entry.until - Date.now()) / 60000);
        throw new HttpError(429, `Too many failed attempts. Try again in ${minutes} minute(s).`);
    }
}

export async function recordFailure(kind, id, max) {
    const key = `${kind}:${id}`;
    const now = Date.now();
    let entry = await store('ratelimit').get(key, { type: 'json' });
    if (!entry || entry.windowStart + LOCK_MINUTES * 60000 < now) entry = { count: 0, windowStart: now };
    entry.count += 1;
    if (entry.count >= max) entry.until = now + LOCK_MINUTES * 60000;
    await store('ratelimit').setJSON(key, entry);
}

export async function clearFailures(kind, id) {
    await store('ratelimit').delete(`${kind}:${id}`);
}

// ------------------------------------------------------------------- audit

export async function audit(actor, action, target, details = '') {
    const at = new Date().toISOString();
    const key = `${at}-${randomBytes(4).toString('hex')}`;
    await store('audit').setJSON(key, {
        at, actor: String(actor).slice(0, 80), action: String(action).slice(0, 40),
        target: String(target).slice(0, 200), details: String(details).slice(0, 500)
    });
}

// ------------------------------------------------------------------- pages

export const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const CATEGORIES = ['country', 'path', 'guide', 'other'];
const LAYOUTS = ['full', 'half', 'third'];

/** Validates and normalizes page content sent by the editor. Throws HttpError(400). */
export function cleanPage(p) {
    const bad = (msg) => { throw new HttpError(400, msg); };
    if (!p || typeof p !== 'object') bad('Missing page.');
    const str = (v, max, name, required = false) => {
        if (v === undefined || v === null) v = '';
        if (typeof v !== 'string') bad(`${name} must be text.`);
        v = v.trim();
        if (required && !v) bad(`${name} is required.`);
        if (v.length > max) bad(`${name} is too long (max ${max}).`);
        return v;
    };
    const page = {
        title: str(p.title, 120, 'Title', true),
        subtitle: str(p.subtitle, 200, 'Subtitle'),
        category: CATEGORIES.includes(p.category) ? p.category : bad('Invalid category.'),
        group: str(p.group, 40, 'Group').toLowerCase(),
        tag: str(p.tag, 4, 'TAG').toUpperCase(),
        accent: COLOR_RE.test(p.accent || '') ? p.accent.toLowerCase() : bad('Invalid accent colour.'),
        navLabel: str(p.navLabel, 60, 'Navigation label'),
        navOrder: Number.isInteger(p.navOrder) && p.navOrder >= 0 && p.navOrder <= 999 ? p.navOrder : bad('Nav order must be 0-999.'),
        published: p.published === true,
        sections: []
    };
    if (!/^[a-z0-9_-]*$/.test(page.group)) bad('Group: lower-case letters, numbers, "_" or "-" only.');
    if (!/^[A-Z0-9]*$/.test(page.tag)) bad('TAG: letters and numbers only.');
    if (!Array.isArray(p.sections) || p.sections.length > 60) bad('Sections: at most 60.');
    for (const s of p.sections) {
        if (!s || typeof s !== 'object') bad('Invalid section.');
        page.sections.push({
            title: str(s.title, 200, 'Section title'),
            layout: LAYOUTS.includes(s.layout) ? s.layout : 'full',
            body: typeof s.body === 'string' && s.body.length <= 60000 ? s.body : bad('A section is too long (max 60000 characters).')
        });
    }
    if (JSON.stringify(page).length > 900000) bad('The page is too big.');
    return page;
}

export function pageSummary(slug, p) {
    return {
        slug, title: p.title, category: p.category, group: p.group, tag: p.tag, accent: p.accent,
        navLabel: p.navLabel, navOrder: p.navOrder, published: p.published, updatedAt: p.updatedAt
    };
}
