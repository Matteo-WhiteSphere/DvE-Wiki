// Admin panel: staff accounts, roles, password resets, activity log.
import {
    api, watchSession, el, isAdminRole, accountActive, creatableRoles, assignableRoles,
    staffUsername, STAFF_NAME_RE, USERNAME_RE, formatDate, friendlyError
} from './wiki.js';

const $ = (id) => document.getElementById(id);
const state = { user: null, role: 'none', users: [], auditNext: null };

function notice(text, kind = '') {
    $('admin-notice').replaceChildren(text ? el('div', { class: 'notice ' + kind, text }) : '');
    if (text) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleAuthError(e) {
    if (e && (e.status === 401 || e.code === 'password-change')) {
        location.replace('login.html?expired=1&next=admin.html');
        return true;
    }
    return false;
}

const roleTag = (r) => el('span', { class: 'role-tag role-' + r, text: r });
const loginPage = () => new URL('login.html', location.href).href;
const exists = (username) => {
    const name = username.split('.').pop().toLowerCase();
    return state.users.some((u) => u.username.split('.').pop().toLowerCase() === name);
};

function copyButton(text) {
    return el('button', { class: 'btn small', type: 'button', text: 'Copy', onclick: async (ev) => {
        try { await navigator.clipboard.writeText(text); ev.target.textContent = 'Copied'; } catch { /* ignore */ }
    } });
}

/** Shows username + temporary password once, with a copy button. */
function showCredentials(box, title, rows) {
    const width = Math.max(8, ...rows.map((r) => r.username.length));
    const text = rows.map((r) => `${r.username.padEnd(width)}  ${r.password}`).join('\n') + `\n\nLogin page: ${loginPage()}`;
    box.replaceChildren(
        el('strong', { text: title + ' ' }),
        'Send each person their password privately — it is shown only now and must be changed at the first login.',
        el('pre', {}, el('code', { text })),
        copyButton(text), ' ',
        el('button', { class: 'btn small', type: 'button', text: 'Hide', onclick: () => box.classList.add('hidden') }));
    box.classList.remove('hidden', 'error');
}

// ---------------------------------------------------------------- users

async function loadUsers() {
    state.users = (await api('users')).users;
    drawUsers();
}

function drawUsers() {
    const q = $('user-search').value.trim().toLowerCase();
    const roles = assignableRoles(state.role);
    const table = $('users-table');
    table.replaceChildren(el('tr', {},
        ...['Account', 'Role', 'Change role', 'Password', 'Last login', 'Created'].map((h) => el('th', { text: h }))));
    for (const u of state.users) {
        if (q && !u.username.toLowerCase().includes(q)) continue;
        const me = u.username === state.user.username;
        const manageable = !me && roles.includes(u.role);
        let roleCell = el('span', { class: 'muted', text: me ? '(you)' : '—' });
        let pwCell = el('span', { class: 'muted', text: u.mustChangePassword ? 'temporary' : '' });
        if (manageable) {
            const select = el('select', {}, ...roles.map((r) => el('option', { value: r, text: r })));
            select.value = u.role;
            const apply = el('button', { class: 'btn small', type: 'button', text: 'Apply', onclick: () => changeRole(u, select.value, apply) });
            roleCell = el('div', { class: 'row', style: 'flex-wrap:nowrap;gap:6px' }, select, el('div', { class: 'shrink' }, apply));
            pwCell = el('div', {},
                u.mustChangePassword ? el('div', { class: 'muted', text: 'temporary' }) : '',
                el('button', { class: 'btn small', type: 'button', text: 'Reset password', onclick: (ev) => resetPassword(u, ev.target) }));
        }
        table.append(el('tr', {},
            el('td', { text: u.username }),
            el('td', {}, roleTag(u.role)),
            el('td', {}, roleCell),
            el('td', {}, pwCell),
            el('td', { text: formatDate(u.lastLogin) }),
            el('td', { text: formatDate(u.createdAt) })));
    }
}

async function changeRole(u, role, btn) {
    if (role === u.role) return;
    if (role === 'admin' && !confirm(`Make ${u.username} an ADMINISTRATOR?\nAdmins can manage editors and delete pages.`)) return;
    btn.disabled = true;
    try {
        const { user } = await api('users/' + encodeURIComponent(u.username), { method: 'PATCH', body: { role } });
        notice(`${u.username} is now ${user.username} (${user.role}).`, 'ok');
        await Promise.all([loadUsers(), loadAudit(true)]);
    } catch (e) {
        if (!handleAuthError(e)) notice('Role change failed: ' + friendlyError(e), 'error');
        btn.disabled = false;
    }
}

async function resetPassword(u, btn) {
    if (!confirm(`Give ${u.username} a new temporary password?\nThe current password stops working immediately.`)) return;
    btn.disabled = true;
    try {
        const { user, password } = await api('users/' + encodeURIComponent(u.username) + '/reset', { method: 'POST' });
        showCredentials($('new-account'), `New password for ${user.username}.`, [{ username: user.username, password }]);
        notice(null);
        await Promise.all([loadUsers(), loadAudit(true)]);
        $('new-account').scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
        if (!handleAuthError(e)) notice('Reset failed: ' + friendlyError(e), 'error');
        btn.disabled = false;
    }
}

// --------------------------------------------------------------- create

function updatePreview() {
    const name = $('new-name').value.trim();
    $('new-preview').textContent = `Login: ${staffUsername($('new-role').value, name || 'Name')}`;
}

async function createOne(ev) {
    ev.preventDefault();
    const name = $('new-name').value.trim();
    if (!STAFF_NAME_RE.test(name)) {
        notice('Name: 2-32 letters, numbers, "_" or "-" (no spaces or dots).', 'error');
        return;
    }
    const username = staffUsername($('new-role').value, name);
    $('create-btn').disabled = true;
    try {
        const { user, password } = await api('users', { method: 'POST', body: { username } });
        showCredentials($('new-account'), `Account ${user.username} created.`, [{ username: user.username, password }]);
        notice(null);
        $('create-form').reset();
        updatePreview();
        await Promise.all([loadUsers(), loadAudit(true)]);
    } catch (e) {
        if (!handleAuthError(e)) notice('Could not create the account: ' + friendlyError(e), 'error');
    } finally { $('create-btn').disabled = false; }
}

async function prefillBulk() {
    try {
        const res = await fetch('data/staff-accounts.json', { cache: 'no-cache' });
        if (!res.ok) return;
        const list = ((await res.json()).accounts || []).map((a) => (typeof a === 'string' ? a : a.username));
        const allowed = creatableRoles(state.role);
        $('bulk-list').value = list
            .filter((u) => !exists(u) && allowed.includes(u.split('.')[0].toLowerCase()))
            .join('\n');
    } catch { /* optional */ }
}

async function bulkCreate() {
    const lines = $('bulk-list').value.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    $('bulk-btn').disabled = true;
    const created = [], problems = [];
    for (const [i, line] of lines.entries()) {
        $('bulk-status').textContent = `${i + 1} / ${lines.length}…`;
        const m = line.match(USERNAME_RE);
        if (!m) { problems.push(`${line}: not in Role.Name format`); continue; }
        const username = staffUsername(m[1].toLowerCase(), m[2]);
        if (exists(username)) { problems.push(`${username}: already exists, skipped`); continue; }
        try {
            const { user, password } = await api('users', { method: 'POST', body: { username } });
            created.push({ username: user.username, password });
        } catch (e) {
            if (handleAuthError(e)) return;
            problems.push(`${username}: ${friendlyError(e)}`);
        }
    }
    $('bulk-status').textContent = '';
    $('bulk-btn').disabled = false;

    const box = $('bulk-result');
    if (created.length) showCredentials(box, `${created.length} account(s) created.`, created);
    else { box.replaceChildren(el('strong', { text: 'No account created.' })); box.classList.remove('hidden'); }
    box.classList.toggle('error', !created.length);
    if (problems.length) box.append(el('ul', {}, ...problems.map((p) => el('li', { text: p }))));
    await Promise.all([loadUsers(), loadAudit(true)]);
    await prefillBulk();
}

// ---------------------------------------------------------------- audit

async function loadAudit(reset = false) {
    const table = $('audit-table');
    if (reset) {
        state.auditNext = null;
        table.replaceChildren(el('tr', {},
            ...['When', 'Who', 'Action', 'Target', 'Details'].map((h) => el('th', { text: h }))));
    }
    const { entries, next } = await api('audit' + (state.auditNext ? '?before=' + encodeURIComponent(state.auditNext) : ''));
    for (const a of entries) {
        table.append(el('tr', {},
            el('td', { text: formatDate(a.at) }),
            el('td', { text: a.actor }),
            el('td', {}, el('code', { text: a.action })),
            el('td', { text: a.target }),
            el('td', { text: a.details || '' })));
    }
    state.auditNext = next;
    $('audit-more').disabled = !next;
}

// ---------------------------------------------------------------- start

watchSession(async ({ user, role }) => {
    if (!user) { location.replace('login.html?next=admin.html'); return; }
    if (user.mustChangePassword) { location.replace('login.html'); return; }
    state.user = user;
    state.role = role;
    $('whoami').textContent = `Signed in as ${user.username} (${role})`;
    if (!isAdminRole(role) || !accountActive(user)) {
        notice('Only administrators can open this page.', 'error');
        return;
    }

    $('new-role').replaceChildren(...creatableRoles(role).reverse().map((r) => el('option', { value: r, text: r })));
    $('create-form').addEventListener('submit', createOne);
    $('new-role').addEventListener('change', updatePreview);
    $('new-name').addEventListener('input', updatePreview);
    updatePreview();
    $('bulk-btn').addEventListener('click', () => bulkCreate().catch((e) => notice(friendlyError(e), 'error')));
    $('user-search').addEventListener('input', drawUsers);
    $('audit-more').addEventListener('click', () => loadAudit(false).catch((e) => notice(friendlyError(e), 'error')));
    $('admin-root').classList.remove('hidden');

    try {
        await loadUsers();
        await Promise.all([loadAudit(true), prefillBulk()]);
    } catch (e) {
        if (!handleAuthError(e)) notice(friendlyError(e), 'error');
    }
});
