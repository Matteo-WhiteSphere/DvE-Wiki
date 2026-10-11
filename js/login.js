// Staff login with "Role.Name" usernames.
import {
    api, login, logout, currentUser, friendlyError, el, isEditorRole, isAdminRole, USERNAME_RE
} from './wiki.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
// Only allow redirects to pages of this site.
const next = /^[a-z_]+\.html(\?[\w=&%.-]*)?$/i.test(params.get('next') || '') ? params.get('next') : null;

function notice(text, kind = '') {
    $('login-notice').replaceChildren(text ? el('div', { class: 'notice ' + kind, text }) : '');
}

if (params.get('expired')) notice('Your session expired. Please sign in again.');

$('login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const username = $('username').value.trim();
    if (!USERNAME_RE.test(username)) {
        notice('Write your username as Role.Name, e.g. Editor.Rapha.', 'error');
        return;
    }
    $('login-btn').disabled = true;
    try {
        const user = await login(username, $('password').value);
        $('password').value = '';
        notice(null);
        show(user);
    } catch (e) {
        notice(friendlyError(e), 'error');
    } finally { $('login-btn').disabled = false; }
});

$('forgot-btn').addEventListener('click', () => {
    notice('Ask an owner or an administrator: they can give you a new temporary password from the Admin panel.');
});

// ------------------------------------------------------- password change

let current = null;

function showPasswordForm(forced) {
    $('change-password').classList.remove('hidden');
    $('signed-in').classList.toggle('hidden', forced);
    $('pw-logout').classList.toggle('hidden', !forced);
    $('pw-cancel').classList.toggle('hidden', forced);
    $('current-password-box').classList.toggle('hidden', forced);
    $('pw-intro').textContent = forced
        ? 'You signed in with a temporary password. Choose your own password to activate the account.'
        : 'Type your current password, then the new one.';
    $('pw-username').value = current ? current.username : '';
    (forced ? $('new-password') : $('current-password')).focus();
}

$('pw-logout').addEventListener('click', async () => { await logout(); show(null); });
$('pw-cancel').addEventListener('click', () => {
    $('password-form').reset();
    $('change-password').classList.add('hidden');
    $('signed-in').classList.remove('hidden');
});

$('password-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const pw = $('new-password').value;
    if (pw !== $('new-password2').value) { notice('The two passwords are different.', 'error'); return; }
    if (pw.length < 10 || !/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw)) {
        notice('At least 10 characters, with upper-case and lower-case letters and a number.', 'error');
        return;
    }
    $('pw-btn').disabled = true;
    try {
        const { user } = await api('password', {
            method: 'POST', body: { currentPassword: $('current-password').value, newPassword: pw }
        });
        $('password-form').reset();
        $('change-password').classList.add('hidden');
        notice('Password saved.', 'ok');
        await currentUser({ refresh: true });
        show(user);
    } catch (e) {
        notice(friendlyError(e), 'error');
    } finally { $('pw-btn').disabled = false; }
});

// ---------------------------------------------------------------- state

function show(user) {
    current = user;
    $('signed-out').classList.toggle('hidden', !!user);
    $('signed-in').classList.toggle('hidden', !user);
    $('change-password').classList.add('hidden');
    if (!user) { $('username').focus(); return; }

    $('me-email').textContent = user.username;
    $('me-role').replaceChildren(el('span', { class: 'role-tag role-' + user.role, text: user.role }));
    const status = $('me-status');
    const actions = $('me-actions');
    status.replaceChildren();
    actions.replaceChildren();

    if (user.mustChangePassword) { showPasswordForm(true); return; }

    if (isEditorRole(user.role)) {
        if (next) { location.replace(next); return; }
        status.append(el('div', { class: 'notice ok', text: 'You are signed in.' }));
        actions.append(el('a', { class: 'btn primary', href: 'editor.html', text: 'Open page editor' }));
        if (isAdminRole(user.role)) actions.append(el('a', { class: 'btn', href: 'admin.html', text: 'Admin panel' }));
    }
    actions.append(
        el('button', { class: 'btn', text: 'Change password', onclick: () => showPasswordForm(false) }),
        el('button', { class: 'btn danger', text: 'Sign out', onclick: async () => { await logout(); notice('Signed out.', 'ok'); show(null); } }));
}

currentUser().then(show);
