// Admin panel: invitations, roles, activity log.
import {
    db, isConfigured, watchSession, enforceIdleTimeout, el, isAdminRole, assignableRoles,
    auditEntry, createPasswordAccount, createStaffLogin, staffUsername, STAFF_NAME_RE,
    loginToEmail, isStaffEmail, accountActive, accountLabel, formatDate, friendlyError
} from './wiki.js';
import {
    doc, collection, getDocs, writeBatch, query, orderBy, limit, startAfter, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const EMAIL_RE = /^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/;

const state = { user: null, role: 'none', users: [], invites: [], lastAudit: null };

function notice(text, kind = '') {
    $('admin-notice').replaceChildren(text ? el('div', { class: 'notice ' + kind, text }) : '');
    if (text) window.scrollTo({ top: 0, behavior: 'smooth' });
}

const roleTag = (r) => el('span', { class: 'role-tag role-' + r, text: r });
const labelOf = (uid) => { const u = state.users.find((x) => x.uid === uid); return u ? accountLabel(u) : uid; };

// ---------------------------------------------------------------- users

async function loadUsers() {
    const snap = await getDocs(collection(db, 'users'));
    state.users = snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
        .sort((a, b) => accountLabel(a).localeCompare(accountLabel(b)));
    drawUsers();
}

function drawUsers() {
    const q = $('user-search').value.trim().toLowerCase();
    const mine = assignableRoles(state.role);
    const table = $('users-table');
    table.replaceChildren(el('tr', {},
        ...['Account', 'Name', 'Role', 'Change role', 'Last login', 'Created'].map((h) => el('th', { text: h }))));
    for (const u of state.users) {
        if (q && !(u.email || '').includes(q) && !(u.displayName || '').toLowerCase().includes(q)) continue;
        const editable = u.uid !== state.user.uid && mine.includes(u.role);
        let control = el('span', { class: 'muted', text: u.uid === state.user.uid ? '(you)' : '—' });
        if (editable) {
            const select = el('select', {}, ...mine.map((r) => el('option', { value: r, text: r })));
            select.value = u.role;
            const apply = el('button', { class: 'btn small', type: 'button', text: 'Apply', onclick: () => changeRole(u, select.value, apply) });
            control = el('div', { class: 'row', style: 'flex-wrap:nowrap;gap:6px' }, select, el('div', { class: 'shrink' }, apply));
        }
        table.append(el('tr', {},
            el('td', { text: accountLabel(u) || '—' }),
            el('td', { text: u.displayName || '' }, u.mustChangePassword ? el('div', { class: 'muted', text: 'temporary password' }) : ''),
            el('td', {}, roleTag(u.role)),
            el('td', {}, control),
            el('td', { text: formatDate(u.lastLogin) }),
            el('td', { text: formatDate(u.createdAt) })));
    }
}

async function changeRole(u, role, btn) {
    if (role === u.role) return;
    if (role === 'admin' && !confirm(`Make ${accountLabel(u)} an ADMINISTRATOR?\nAdmins can manage editors and delete pages.`)) return;
    btn.disabled = true;
    try {
        const batch = writeBatch(db);
        batch.update(doc(db, 'users', u.uid), {
            role, roleUpdatedBy: state.user.uid, roleUpdatedAt: serverTimestamp()
        });
        const a = auditEntry(state.user, 'user.role', accountLabel(u) || u.uid, `${u.role} → ${role}`);
        batch.set(a.ref, a.data);
        await batch.commit();
        notice(`${accountLabel(u)}: role changed to ${role}.`, 'ok');
        await Promise.all([loadUsers(), loadAudit(true)]);
    } catch (e) {
        notice('Role change failed: ' + friendlyError(e), 'error');
        btn.disabled = false;
    }
}

// -------------------------------------------------------------- invites

async function loadInvites() {
    const snap = await getDocs(collection(db, 'invites'));
    state.invites = snap.docs.map((d) => ({ email: d.id, ...d.data() }));
    const table = $('invites-table');
    table.replaceChildren(el('tr', {},
        ...['E-mail', 'Role', 'Method', 'Invited by', 'Date', ''].map((h) => el('th', { text: h }))));
    for (const inv of state.invites) {
        table.append(el('tr', {},
            el('td', { text: inv.email }),
            el('td', {}, roleTag(inv.role)),
            el('td', { text: inv.method === 'password' ? 'E-mail + password' : 'Google' }),
            el('td', { text: labelOf(inv.invitedBy) }),
            el('td', { text: formatDate(inv.createdAt) }),
            el('td', {}, el('button', { class: 'btn small danger', type: 'button', text: 'Revoke', onclick: () => revokeInvite(inv) }))));
    }
    if (!state.invites.length) table.append(el('tr', {}, el('td', { colspan: '6', class: 'muted', text: 'No pending invitations.' })));
}

async function revokeInvite(inv) {
    if (!confirm(`Revoke the invitation for ${inv.email}?`)) return;
    try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'invites', inv.email));
        const a = auditEntry(state.user, 'invite.revoke', inv.email, inv.role);
        batch.set(a.ref, a.data);
        await batch.commit();
        await Promise.all([loadInvites(), loadAudit(true)]);
    } catch (e) { notice('Revoke failed: ' + friendlyError(e), 'error'); }
}

function updateInviteForm() {
    const staff = $('inv-method').value === 'staff';
    const input = $('inv-email');
    $('inv-email-label').textContent = staff ? 'Name' : 'E-mail';
    input.placeholder = staff ? 'Rapha' : 'dev@example.com';
    const name = input.value.trim();
    $('inv-preview').textContent = staff
        ? `Login: ${staffUsername($('inv-role').value, name || 'Name')}`
        : '';
}

async function createStaff(name, role) {
    if (!STAFF_NAME_RE.test(name)) {
        notice('Name: 2-32 letters, numbers, "_" or "-" (no spaces or dots).', 'error');
        return;
    }
    const username = staffUsername(role, name);
    if (state.users.some((u) => u.email === loginToEmail(username))) {
        notice(`${username} already exists.`, 'error');
        return;
    }
    const { uid, email, password } = await createStaffLogin(username);
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', uid), {
        email, displayName: username, role, mustChangePassword: true,
        createdBy: state.user.uid, createdAt: serverTimestamp()
    });
    const a = auditEntry(state.user, 'account.create', username, role);
    batch.set(a.ref, a.data);
    await batch.commit();

    const box = $('new-account');
    const text = `Username: ${username}\nTemporary password: ${password}\nLogin page: ${new URL('login.html', location.href).href}`;
    box.replaceChildren(
        el('strong', { text: `Account ${username} created. ` }),
        'Send these details privately — the password is shown only now and must be changed at the first login.',
        el('pre', {}, el('code', { text })),
        el('button', { class: 'btn small', type: 'button', text: 'Copy', onclick: async (ev) => {
            try { await navigator.clipboard.writeText(text); ev.target.textContent = 'Copied'; } catch { /* ignore */ }
        } }),
        ' ',
        el('button', { class: 'btn small', type: 'button', text: 'Hide', onclick: () => box.classList.add('hidden') }));
    box.classList.remove('hidden');
    notice(null);
    $('invite-form').reset();
    updateInviteForm();
    await Promise.all([loadUsers(), loadAudit(true)]);
}

async function invite(ev) {
    ev.preventDefault();
    const role = $('inv-role').value;
    const method = $('inv-method').value;
    if (method === 'staff') {
        $('inv-btn').disabled = true;
        try { await createStaff($('inv-email').value.trim(), role); }
        catch (e) { notice('Could not create the account: ' + friendlyError(e), 'error'); }
        finally { $('inv-btn').disabled = false; }
        return;
    }

    const email = $('inv-email').value.trim().toLowerCase();
    if (!EMAIL_RE.test(email) || isStaffEmail(email)) { notice('Invalid e-mail address.', 'error'); return; }

    const existing = state.users.find((u) => u.email === email);
    if (existing && existing.role !== 'user') {
        notice(`${email} already has an account (role: ${existing.role}). Change the role in the Users table.`, 'error');
        return;
    }

    $('inv-btn').disabled = true;
    try {
        const batch = writeBatch(db);
        batch.set(doc(db, 'invites', email), {
            role, method, invitedBy: state.user.uid, createdAt: serverTimestamp()
        });
        const a = auditEntry(state.user, 'invite.create', email, `${role} via ${method}`);
        batch.set(a.ref, a.data);
        await batch.commit();

        let msg = `Invitation saved: ${email} will become ${role} at the first login.`;
        if (method === 'password') {
            const { created } = await createPasswordAccount(email);
            msg += created
                ? ' An e-mail has been sent to choose the password.'
                : ' That address already had a login: a password-reset e-mail has been sent.';
        } else {
            msg += ' Tell them to open the Staff area and press "Sign in with Google".';
        }
        if (existing) msg += ' (Their user account will be upgraded at the next login.)';
        notice(msg, 'ok');
        $('invite-form').reset();
        updateInviteForm();
        await Promise.all([loadInvites(), loadAudit(true)]);
    } catch (e) {
        notice('Could not add the account: ' + friendlyError(e), 'error');
    } finally {
        $('inv-btn').disabled = false;
    }
}

// ---------------------------------------------------------------- audit

async function loadAudit(reset = false) {
    const table = $('audit-table');
    if (reset || !state.lastAudit) {
        state.lastAudit = null;
        table.replaceChildren(el('tr', {},
            ...['When', 'Who', 'Action', 'Target', 'Details'].map((h) => el('th', { text: h }))));
    }
    const parts = [collection(db, 'audit'), orderBy('at', 'desc')];
    if (state.lastAudit) parts.push(startAfter(state.lastAudit));
    parts.push(limit(50));
    const snap = await getDocs(query(...parts));
    snap.forEach((d) => {
        const a = d.data();
        table.append(el('tr', {},
            el('td', { text: formatDate(a.at) }),
            el('td', { text: a.actor === 'admin-sdk' ? 'tools/accounts.mjs' : labelOf(a.actor) }),
            el('td', {}, el('code', { text: a.action })),
            el('td', { text: a.target }),
            el('td', { text: a.details || '' })));
    });
    if (!snap.empty) state.lastAudit = snap.docs[snap.docs.length - 1];
    $('audit-more').disabled = snap.size < 50;
}

// ---------------------------------------------------------------- start

let started = false;
watchSession(async ({ user, profile, role }) => {
    if (!isConfigured) { notice('The staff area is not configured yet (see STAFF_SETUP.md).', 'error'); return; }
    if (!user) { location.replace('login.html?next=admin.html'); return; }
    state.user = user;
    state.role = role;
    $('whoami').textContent = `Signed in as ${accountLabel(profile, user)} (${role})`;
    if (profile && profile.mustChangePassword) { location.replace('login.html'); return; }
    if (!isAdminRole(role) || !accountActive(user, profile)) {
        $('admin-root').classList.add('hidden');
        notice('Only administrators can open this page.', 'error');
        return;
    }
    if (started) return;
    started = true;
    enforceIdleTimeout();

    const roles = assignableRoles(role).filter((r) => r === 'editor' || r === 'admin');
    $('inv-role').replaceChildren(...roles.map((r) => el('option', { value: r, text: r })));
    $('invite-form').addEventListener('submit', invite);
    for (const id of ['inv-method', 'inv-role', 'inv-email']) $(id).addEventListener('input', updateInviteForm);
    updateInviteForm();
    $('user-search').addEventListener('input', drawUsers);
    $('audit-more').addEventListener('click', () => loadAudit(false).catch((e) => notice(friendlyError(e), 'error')));
    $('admin-root').classList.remove('hidden');

    try {
        await loadUsers();
        await Promise.all([loadInvites(), loadAudit(true)]);
    } catch (e) { notice(friendlyError(e), 'error'); }
});
