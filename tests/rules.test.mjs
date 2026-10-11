// Security-rule tests. Run from this folder:  npm install && npm test
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import {
    initializeTestEnvironment, assertFails, assertSucceeds
} from '@firebase/rules-unit-testing';
import {
    doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where,
    serverTimestamp, Timestamp
} from 'firebase/firestore';

let env;
const RULES = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

before(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-dve', firestore: { rules: RULES } });
});
after(async () => { await env.cleanup(); });

const verified = (email) => ({ email, email_verified: true });
const ctx = (uid, email, isVerified = true) => env.authenticatedContext(uid, { email, email_verified: isVerified }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

const people = {
    owner: ['owner1', 'owner@x.com'],
    admin: ['admin1', 'admin@x.com'],
    admin2: ['admin2', 'admin2@x.com'],
    mod: ['mod1', 'mod@x.com'],
    pending: ['pend1', 'pend@x.com'],
    disabled: ['dis1', 'dis@x.com']
};
const as = (k, isVerified = true) => ctx(people[k][0], people[k][1], isVerified);

function page(uid, extra = {}) {
    return {
        title: 'Test', subtitle: 'Sub', category: 'country', group: 'tst', tag: 'TST',
        accent: '#112233', navLabel: 'Test', navOrder: 0, sections: [{ title: 'A', layout: 'full', body: 'x' }],
        published: true, createdBy: uid, createdAt: serverTimestamp(), updatedBy: uid,
        updatedByEmail: 'x', updatedAt: serverTimestamp(), ...extra
    };
}

beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (c) => {
        const db = c.firestore();
        const roles = { owner: 'owner', admin: 'admin', admin2: 'admin', mod: 'moderator', pending: 'pending', disabled: 'disabled' };
        for (const [k, role] of Object.entries(roles)) {
            await setDoc(doc(db, 'users', people[k][0]), { email: people[k][1], displayName: k, role, createdAt: Timestamp.now(), lastLogin: Timestamp.now() });
        }
        await setDoc(doc(db, 'pages', 'pub'), { ...page('mod1'), createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
        await setDoc(doc(db, 'pages', 'draft'), { ...page('mod1'), published: false, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    });
});

// ------------------------------------------------------------------ pages
test('anyone can read published pages and missing pages, not drafts', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'pages', 'pub')));
    await assertSucceeds(getDoc(doc(anon(), 'pages', 'does_not_exist')));
    await assertFails(getDoc(doc(anon(), 'pages', 'draft')));
    await assertFails(getDoc(doc(as('pending'), 'pages', 'draft')));
    await assertSucceeds(getDoc(doc(as('mod'), 'pages', 'draft')));
    await assertSucceeds(getDocs(query(collection(anon(), 'pages'), where('published', '==', true))));
    await assertFails(getDocs(collection(anon(), 'pages')));
    await assertSucceeds(getDocs(collection(as('mod'), 'pages')));
});

test('only verified moderators+ can create pages', async () => {
    await assertFails(setDoc(doc(anon(), 'pages', 'new1'), page('x')));
    await assertFails(setDoc(doc(as('pending'), 'pages', 'new1'), page('pend1')));
    await assertFails(setDoc(doc(as('disabled'), 'pages', 'new1'), page('dis1')));
    await assertFails(setDoc(doc(as('mod', false), 'pages', 'new1'), page('mod1')));
    await assertSucceeds(setDoc(doc(as('mod'), 'pages', 'new1'), page('mod1')));
});

test('page validation', async () => {
    const db = as('mod');
    await assertFails(setDoc(doc(db, 'pages', 'Bad Slug'), page('mod1')));
    await assertFails(setDoc(doc(db, 'pages', 'n2'), page('mod1', { accent: 'red;x' })));
    await assertFails(setDoc(doc(db, 'pages', 'n2'), page('mod1', { title: '' })));
    await assertFails(setDoc(doc(db, 'pages', 'n2'), page('mod1', { category: 'evil' })));
    await assertFails(setDoc(doc(db, 'pages', 'n2'), page('mod1', { extraField: 1 })));
    await assertFails(setDoc(doc(db, 'pages', 'n2'), page('admin1'))); // spoofed author
    await assertFails(setDoc(doc(db, 'pages', 'n2'), page('mod1', { updatedAt: Timestamp.now() })));
});

test('moderators edit, only admins delete', async () => {
    const mod = as('mod');
    const snap = await getDoc(doc(mod, 'pages', 'pub'));
    const { createdAt } = snap.data();
    await assertSucceeds(setDoc(doc(mod, 'pages', 'pub'), page('mod1', { createdAt, title: 'Edited' })));
    await assertFails(setDoc(doc(mod, 'pages', 'pub'), page('mod1', { createdAt: Timestamp.now() })));
    await assertFails(deleteDoc(doc(mod, 'pages', 'pub')));
    await assertSucceeds(deleteDoc(doc(as('admin'), 'pages', 'pub')));
});

test('revisions are append-only', async () => {
    const mod = as('mod');
    const rev = doc(mod, 'pages', 'pub', 'revisions', 'r1');
    await assertSucceeds(setDoc(rev, { title: 't', savedBy: 'mod1', savedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(mod, 'pages', 'pub', 'revisions', 'r2'), { savedBy: 'admin1', savedAt: serverTimestamp() }));
    await assertFails(updateDoc(rev, { title: 'changed' }));
    await assertFails(deleteDoc(rev));
    await assertFails(getDoc(doc(anon(), 'pages', 'pub', 'revisions', 'r1')));
});

// ------------------------------------------------------------------ users
test('self-registration only as pending', async () => {
    const db = ctx('new1', 'new@x.com');
    const base = { email: 'new@x.com', displayName: 'n', createdAt: serverTimestamp(), lastLogin: serverTimestamp() };
    await assertFails(setDoc(doc(db, 'users', 'new1'), { ...base, role: 'moderator' }));
    await assertFails(setDoc(doc(db, 'users', 'new1'), { ...base, role: 'owner' }));
    await assertFails(setDoc(doc(db, 'users', 'other'), { ...base, role: 'pending' }));
    await assertFails(setDoc(doc(db, 'users', 'new1'), { ...base, email: 'admin@x.com', role: 'pending' }));
    await assertSucceeds(setDoc(doc(db, 'users', 'new1'), { ...base, role: 'pending' }));
});

test('invited verified user gets the invited role, unverified does not', async () => {
    await assertSucceeds(setDoc(doc(as('admin'), 'invites', 'new@x.com'), { role: 'moderator', method: 'google', invitedBy: 'admin1', createdAt: serverTimestamp() }));
    const base = { email: 'new@x.com', displayName: 'n', createdAt: serverTimestamp(), lastLogin: serverTimestamp() };
    await assertFails(setDoc(doc(ctx('new1', 'new@x.com', false), 'users', 'new1'), { ...base, role: 'moderator' }));
    await assertFails(setDoc(doc(ctx('new1', 'new@x.com'), 'users', 'new1'), { ...base, role: 'admin' }));
    await assertSucceeds(setDoc(doc(ctx('new1', 'new@x.com'), 'users', 'new1'), { ...base, role: 'moderator' }));
    await assertSucceeds(deleteDoc(doc(ctx('new1', 'new@x.com'), 'invites', 'new@x.com')));
});

test('pending user upgrades through invite only', async () => {
    const db = as('pending');
    await assertFails(updateDoc(doc(db, 'users', 'pend1'), { role: 'moderator', lastLogin: serverTimestamp() }));
    await setDoc(doc(as('admin'), 'invites', 'pend@x.com'), { role: 'moderator', method: 'google', invitedBy: 'admin1', createdAt: serverTimestamp() });
    await assertSucceeds(updateDoc(doc(db, 'users', 'pend1'), { role: 'moderator', lastLogin: serverTimestamp() }));
});

test('users cannot change their own role', async () => {
    await assertFails(updateDoc(doc(as('mod'), 'users', 'mod1'), { role: 'admin' }));
    await assertFails(updateDoc(doc(as('admin'), 'users', 'admin1'), { role: 'owner', roleUpdatedBy: 'admin1', roleUpdatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(as('mod'), 'users', 'mod1'), { displayName: 'New name', lastLogin: serverTimestamp() }));
});

test('role hierarchy', async () => {
    const r = (role, by) => ({ role, roleUpdatedBy: by, roleUpdatedAt: serverTimestamp() });
    // moderator cannot manage anybody
    await assertFails(updateDoc(doc(as('mod'), 'users', 'pend1'), r('moderator', 'mod1')));
    // admin manages moderators / pending / disabled
    await assertSucceeds(updateDoc(doc(as('admin'), 'users', 'pend1'), r('moderator', 'admin1')));
    await assertSucceeds(updateDoc(doc(as('admin'), 'users', 'mod1'), r('disabled', 'admin1')));
    // admin cannot create admins, touch other admins or the owner
    await assertFails(updateDoc(doc(as('admin'), 'users', 'dis1'), r('admin', 'admin1')));
    await assertFails(updateDoc(doc(as('admin'), 'users', 'admin2'), r('disabled', 'admin1')));
    await assertFails(updateDoc(doc(as('admin'), 'users', 'owner1'), r('disabled', 'admin1')));
    // owner manages admins, nobody can grant owner
    await assertSucceeds(updateDoc(doc(as('owner'), 'users', 'dis1'), r('admin', 'owner1')));
    await assertSucceeds(updateDoc(doc(as('owner'), 'users', 'admin2'), r('moderator', 'owner1')));
    await assertFails(updateDoc(doc(as('owner'), 'users', 'mod1'), r('owner', 'owner1')));
    // spoofed roleUpdatedBy
    await assertFails(updateDoc(doc(as('owner'), 'users', 'pend1'), r('moderator', 'admin1')));
});

test('profiles are private', async () => {
    await assertFails(getDoc(doc(as('mod'), 'users', 'admin1')));
    await assertFails(getDocs(collection(as('mod'), 'users')));
    await assertSucceeds(getDoc(doc(as('mod'), 'users', 'mod1')));
    await assertSucceeds(getDocs(collection(as('admin'), 'users')));
});

// ---------------------------------------------------------------- invites
test('invite permissions', async () => {
    const inv = (role, by) => ({ role, method: 'password', invitedBy: by, createdAt: serverTimestamp() });
    await assertFails(setDoc(doc(as('mod'), 'invites', 'a@x.com'), inv('moderator', 'mod1')));
    await assertFails(setDoc(doc(as('admin'), 'invites', 'a@x.com'), inv('admin', 'admin1')));
    await assertFails(setDoc(doc(as('admin'), 'invites', 'A@x.com'), inv('moderator', 'admin1')));
    await assertFails(setDoc(doc(as('owner'), 'invites', 'a@x.com'), inv('owner', 'owner1')));
    await assertSucceeds(setDoc(doc(as('admin'), 'invites', 'a@x.com'), inv('moderator', 'admin1')));
    await assertSucceeds(setDoc(doc(as('owner'), 'invites', 'b@x.com'), inv('admin', 'owner1')));
    await assertFails(getDoc(doc(as('mod'), 'invites', 'a@x.com')));
    await assertFails(getDoc(doc(ctx('z', 'a@x.com', false), 'invites', 'a@x.com')));
    await assertSucceeds(getDoc(doc(ctx('z', 'a@x.com'), 'invites', 'a@x.com')));
});

// ------------------------------------------------------------------ audit
test('audit log is append-only and admin-readable', async () => {
    const entry = (actor, email) => ({ action: 'page.update', target: 'pub', details: '', actor, actorEmail: email, at: serverTimestamp() });
    await assertFails(setDoc(doc(as('pending'), 'audit', 'a1'), entry('pend1', 'pend@x.com')));
    await assertFails(setDoc(doc(as('mod'), 'audit', 'a1'), entry('admin1', 'admin@x.com')));
    await assertSucceeds(setDoc(doc(as('mod'), 'audit', 'a1'), entry('mod1', 'mod@x.com')));
    await assertFails(updateDoc(doc(as('owner'), 'audit', 'a1'), { details: 'x' }));
    await assertFails(deleteDoc(doc(as('owner'), 'audit', 'a1')));
    await assertFails(getDoc(doc(as('mod'), 'audit', 'a1')));
    await assertSucceeds(getDoc(doc(as('admin'), 'audit', 'a1')));
});

test('unknown collections are closed', async () => {
    await assertFails(setDoc(doc(as('owner'), 'whatever', 'x'), { a: 1 }));
});
