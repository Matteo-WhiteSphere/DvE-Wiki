#!/usr/bin/env node
// Staff account management for the DvE wiki (Firebase Admin SDK).
//
//   node accounts.mjs create                  create every account in data/staff-accounts.json
//   node accounts.mjs list                    list staff accounts and roles
//   node accounts.mjs reset Editor.Rapha      give a new temporary password
//   node accounts.mjs role Editor.Rapha admin change role (the login becomes Admin.Rapha)
//
// Options:
//   --key <file>      service-account JSON (Firebase console → Project settings →
//                     Service accounts → Generate new private key). Never commit it!
//                     Alternatively set GOOGLE_APPLICATION_CREDENTIALS.
//   --project <id>    Firebase project id (default: from the key file)
//   --file <file>     account list (default: ../data/staff-accounts.json)
//   --emulator        use the local Firebase emulators (project demo-dve)
//
// Temporary passwords are printed once and must be changed at the first login.
import { readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const here = dirname(fileURLToPath(import.meta.url));
const ROLE_PREFIX = { owner: 'Owner', admin: 'Admin', editor: 'Editor' };
const ROLES = ['owner', 'admin', 'editor', 'user', 'disabled'];
const USERNAME_RE = /^(owner|admin|editor)\.([a-z0-9_-]{2,32})$/i;

// Same domain as the website (single source of truth: js/firebase-config.js).
const DOMAIN = (() => {
    const cfg = readFileSync(resolve(here, '../js/firebase-config.js'), 'utf8');
    const m = cfg.match(/USERNAME_DOMAIN\s*=\s*"([^"]+)"/);
    if (!m) throw new Error('USERNAME_DOMAIN not found in js/firebase-config.js');
    return m[1];
})();

// ------------------------------------------------------------------ args
const argv = process.argv.slice(2);
const opts = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--emulator') opts.emulator = true;
    else if (a.startsWith('--')) opts[a.slice(2)] = argv[++i];
    else positional.push(a);
}
const [command, ...rest] = positional;

function usage(msg) {
    if (msg) console.error('Error: ' + msg + '\n');
    console.error(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 18)
        .map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(1);
}

// ------------------------------------------------------------------ init
if (opts.emulator) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
    process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
    initializeApp({ projectId: opts.project || 'demo-dve' });
} else if (opts.key) {
    const key = JSON.parse(readFileSync(resolve(opts.key), 'utf8'));
    initializeApp({ credential: cert(key), projectId: opts.project || key.project_id });
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp({ credential: applicationDefault(), projectId: opts.project });
} else if (command) {
    usage('missing credentials: pass --key <service-account.json> (or --emulator for local tests).');
}
const auth = command ? getAuth() : null;
const db = command ? getFirestore() : null;

// --------------------------------------------------------------- helpers
function parseUsername(username) {
    const m = String(username || '').match(USERNAME_RE);
    if (!m) throw new Error(`"${username}" is not a valid username (Owner.Name, Admin.Name or Editor.Name).`);
    const role = m[1].toLowerCase();
    const name = m[2];
    return { role, name, username: `${ROLE_PREFIX[role]}.${name}`, email: `${role}.${name.toLowerCase()}@${DOMAIN}` };
}

function tempPassword() {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ', lower = 'abcdefghijkmnopqrstuvwxyz', digits = '23456789';
    const all = upper + lower + digits;
    const chars = Array.from({ length: 16 }, (_, i) => {
        const set = i === 0 ? upper : i === 1 ? lower : i === 2 ? digits : all;
        return set[randomInt(set.length)];
    });
    return chars.join('').match(/.{4}/g).join('-');
}

async function findUser(email) {
    try { return await auth.getUserByEmail(email); }
    catch (e) { if (e.code === 'auth/user-not-found') return null; throw e; }
}

/** Finds an account by its name whatever its current role prefix is. */
async function findStaff(username) {
    const { name } = parseUsername(username);
    for (const role of Object.keys(ROLE_PREFIX)) {
        const user = await findUser(`${role}.${name.toLowerCase()}@${DOMAIN}`);
        if (user) return user;
    }
    throw new Error(`No staff account found for "${username}".`);
}

function audit(action, target, details) {
    return db.collection('audit').add({
        action, target, details, actor: 'admin-sdk', actorEmail: 'tools/accounts.mjs',
        at: FieldValue.serverTimestamp()
    });
}

function printCredentials(rows) {
    if (!rows.length) return;
    const width = Math.max(...rows.map((r) => r.username.length), 8);
    console.log('\n  ' + 'Username'.padEnd(width) + '   Temporary password');
    console.log('  ' + '-'.repeat(width) + '   ' + '-'.repeat(19));
    for (const r of rows) console.log('  ' + r.username.padEnd(width) + '   ' + r.password);
    console.log('\n  Send each password privately. It is shown only now and must be changed at the first login.\n');
}

// -------------------------------------------------------------- commands
async function create() {
    const file = opts.file ? resolve(opts.file) : resolve(here, '../data/staff-accounts.json');
    const list = JSON.parse(readFileSync(file, 'utf8')).accounts;
    const accounts = list.map(parseUsername); // validate everything first
    const created = [];
    for (const a of accounts) {
        const existing = await findUser(a.email);
        if (existing) {
            const ref = db.doc(`users/${existing.uid}`);
            if (!(await ref.get()).exists) {
                await ref.set({ email: a.email, displayName: a.username, role: a.role, createdBy: 'admin-sdk', createdAt: FieldValue.serverTimestamp() });
            }
            console.log(`= ${a.username} already exists, skipped`);
            continue;
        }
        const password = tempPassword();
        const user = await auth.createUser({ email: a.email, password, displayName: a.username, emailVerified: true });
        await db.doc(`users/${user.uid}`).set({
            email: a.email, displayName: a.username, role: a.role, mustChangePassword: true,
            createdBy: 'admin-sdk', createdAt: FieldValue.serverTimestamp()
        });
        await audit('account.create', a.username, a.role);
        console.log(`+ ${a.username} created (${a.role})`);
        created.push({ username: a.username, password });
    }
    printCredentials(created);
}

async function list() {
    const snap = await db.collection('users').get();
    const rows = snap.docs.map((d) => d.data()).sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email));
    for (const u of rows) {
        const label = u.email.endsWith('@' + DOMAIN) ? u.displayName : u.email;
        console.log(`${(u.role || '?').padEnd(9)} ${label}${u.mustChangePassword ? '  (temporary password)' : ''}`);
    }
}

async function reset(username) {
    const user = await findStaff(username);
    const password = tempPassword();
    await auth.updateUser(user.uid, { password });
    await auth.revokeRefreshTokens(user.uid);
    await db.doc(`users/${user.uid}`).update({ mustChangePassword: true });
    await audit('account.reset', user.displayName || user.email, 'temporary password');
    printCredentials([{ username: user.displayName || user.email, password }]);
}

async function setRole(username, role) {
    if (!ROLES.includes(role)) throw new Error(`Role must be one of: ${ROLES.join(', ')}`);
    const user = await findStaff(username);
    const { name } = parseUsername(username);
    const update = { role };
    const authUpdate = { disabled: role === 'disabled' };
    if (ROLE_PREFIX[role]) {
        const target = parseUsername(`${ROLE_PREFIX[role]}.${name}`);
        if (target.email !== user.email) {
            if (await findUser(target.email)) throw new Error(`${target.username} already exists.`);
            authUpdate.email = target.email;
            authUpdate.emailVerified = true;
            authUpdate.displayName = target.username;
            update.email = target.email;
            update.displayName = target.username;
        }
    }
    await auth.updateUser(user.uid, authUpdate);
    await auth.revokeRefreshTokens(user.uid);
    await db.doc(`users/${user.uid}`).update(update);
    await audit('user.role', update.displayName || user.displayName || user.email, `→ ${role}`);
    console.log(`${user.displayName || user.email}: role ${role}${update.displayName ? `, login is now ${update.displayName}` : ''}`);
}

// ------------------------------------------------------------------ main
try {
    if (command === 'create') await create();
    else if (command === 'list') await list();
    else if (command === 'reset' && rest[0]) await reset(rest[0]);
    else if (command === 'role' && rest[0] && rest[1]) await setRole(rest[0], rest[1].toLowerCase());
    else usage(command ? `unknown command "${command}"` : '');
    process.exit(0);
} catch (e) {
    console.error('Error: ' + (e.message || e));
    process.exit(1);
}
