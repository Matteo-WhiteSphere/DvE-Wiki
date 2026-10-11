// Staff login: Google, "Role.Name" staff accounts or e-mail/password.
import {
    auth, db, isConfigured, watchSession, logout, friendlyError, el, isEditorRole, isAdminRole,
    loginToEmail, isStaffEmail, accountLabel
} from './wiki.js';
import {
    GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, sendPasswordResetEmail,
    sendEmailVerification, updatePassword
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
// Only allow redirects to pages of this site.
const next = /^[a-z_]+\.html(\?[\w=&%.-]*)?$/i.test(params.get('next') || '') ? params.get('next') : null;

function notice(text, kind = '') {
    $('login-notice').replaceChildren(text ? el('div', { class: 'notice ' + kind, text }) : '');
}

function busy(on) {
    for (const id of ['google-btn', 'email-btn', 'reset-btn']) $(id).disabled = on;
}

if (!isConfigured) {
    notice('The staff area is not configured yet: fill in js/firebase-config.js (see STAFF_SETUP.md).', 'error');
} else if (params.get('expired')) {
    notice('Your session expired after a period of inactivity. Please sign in again.');
}

$('google-btn').addEventListener('click', async () => {
    busy(true);
    try {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        await signInWithPopup(auth, provider);
    } catch (e) {
        notice(friendlyError(e), 'error');
    } finally { busy(false); }
});

$('email-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = loginToEmail($('email').value);
    if (!email) { notice('Write your username as Role.Name (e.g. Editor.Rapha) or your e-mail address.', 'error'); return; }
    busy(true);
    try {
        await signInWithEmailAndPassword(auth, email, $('password').value);
        $('password').value = '';
        notice(null);
    } catch (e) {
        notice(friendlyError(e), 'error');
    } finally { busy(false); }
});

$('reset-btn').addEventListener('click', async () => {
    const email = loginToEmail($('email').value);
    if (!email) { notice('Type your username or e-mail first, then press "Forgot password?".'); return; }
    if (isStaffEmail(email)) {
        notice('Staff usernames have no e-mail: ask an owner to reset your password.');
        return;
    }
    busy(true);
    try {
        await sendPasswordResetEmail(auth, email);
    } catch (e) { /* same answer either way: do not reveal which addresses exist */ }
    notice('If an account exists for that address, a password-reset e-mail has been sent.', 'ok');
    busy(false);
});

// ------------------------------------------------------- password change

let session = null;
let forced = false;

function showPasswordForm(isForced) {
    forced = isForced;
    $('change-password').classList.remove('hidden');
    $('signed-in').classList.toggle('hidden', isForced);
    $('pw-logout').classList.toggle('hidden', !isForced);
    $('pw-username').value = session && session.user ? accountLabel(session.profile, session.user) : '';
    $('new-password').focus();
}

$('pw-logout').addEventListener('click', () => logout());

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
        await updatePassword(session.user, pw);
        if (session.profile && session.profile.mustChangePassword) {
            await updateDoc(doc(db, 'users', session.user.uid), { mustChangePassword: false });
        }
        $('password-form').reset();
        $('change-password').classList.add('hidden');
        notice('Password saved.', 'ok');
        if (forced) { location.reload(); return; }
        $('signed-in').classList.remove('hidden');
    } catch (e) {
        notice(friendlyError(e), 'error');
    } finally { $('pw-btn').disabled = false; }
});

// ---------------------------------------------------------------- state

function roleTag(role) {
    return el('span', { class: 'role-tag role-' + role, text: role });
}

watchSession((s) => {
    session = s;
    const { user, profile, role, error } = s;
    if (!isConfigured) { $('signed-out').classList.remove('hidden'); busy(true); return; }
    $('signed-out').classList.toggle('hidden', !!user);
    $('signed-in').classList.toggle('hidden', !user);
    $('change-password').classList.add('hidden');
    if (!user) return;

    $('me-email').textContent = accountLabel(profile, user) || '—';
    $('me-role').replaceChildren(roleTag(role));
    const status = $('me-status');
    const actions = $('me-actions');
    status.replaceChildren();
    actions.replaceChildren();

    const isPasswordUser = user.providerData.some((p) => p.providerId === 'password');
    const staff = isStaffEmail(user.email);

    if (profile && profile.mustChangePassword) {
        showPasswordForm(true);
        return;
    }

    if (error) {
        status.append(el('div', { class: 'notice error', text: 'Could not load your profile: ' + friendlyError(error) }));
    } else if (!user.emailVerified && isPasswordUser && !staff) {
        status.append(el('div', { class: 'notice' },
            el('strong', { text: 'E-mail not verified. ' }),
            'You must verify your address before you can edit the wiki.'));
        actions.append(
            el('button', { class: 'btn', text: 'Send verification e-mail', onclick: async (ev) => {
                ev.target.disabled = true;
                try { await sendEmailVerification(user); notice('Verification e-mail sent. Open the link, then press "I verified it".', 'ok'); }
                catch (e) { notice(friendlyError(e), 'error'); ev.target.disabled = false; }
            } }),
            el('button', { class: 'btn', text: 'I verified it', onclick: async () => { await user.reload(); await user.getIdToken(true); location.reload(); } })
        );
    } else if (role === 'user') {
        status.append(el('div', { class: 'notice' },
            el('strong', { text: 'User account. ' }),
            'You can read the wiki. To edit pages, ask an administrator for the editor role (send them the account shown above).'));
    } else if (role === 'disabled') {
        status.append(el('div', { class: 'notice error', text: 'This account has been disabled by an administrator.' }));
    } else if (isEditorRole(role)) {
        if (next) { location.replace(next); return; }
        status.append(el('div', { class: 'notice ok', text: 'You are signed in.' }));
        actions.append(el('a', { class: 'btn primary', href: 'editor.html', text: 'Open page editor' }));
        if (isAdminRole(role)) actions.append(el('a', { class: 'btn', href: 'admin.html', text: 'Admin panel' }));
    }
    if (isPasswordUser) actions.append(el('button', { class: 'btn', text: 'Change password', onclick: () => showPasswordForm(false) }));
    actions.append(el('button', { class: 'btn danger', text: 'Sign out', onclick: () => logout() }));
});
