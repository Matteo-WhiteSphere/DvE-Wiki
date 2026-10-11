// Staff login: Google or e-mail/password.
import {
    auth, isConfigured, watchSession, logout, friendlyError, el, isEditorRole, isAdminRole
} from './wiki.js';
import {
    GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, sendPasswordResetEmail,
    sendEmailVerification
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

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
    busy(true);
    try {
        await signInWithEmailAndPassword(auth, $('email').value.trim(), $('password').value);
        $('password').value = '';
    } catch (e) {
        notice(friendlyError(e), 'error');
    } finally { busy(false); }
});

$('reset-btn').addEventListener('click', async () => {
    const email = $('email').value.trim();
    if (!email) { notice('Type your e-mail address first, then press "Forgot password?".'); return; }
    busy(true);
    try {
        await sendPasswordResetEmail(auth, email);
    } catch (e) { /* same answer either way: do not reveal which addresses exist */ }
    notice('If an account exists for that address, a password-reset e-mail has been sent.', 'ok');
    busy(false);
});

function roleTag(role) {
    return el('span', { class: 'role-tag role-' + role, text: role });
}

watchSession(({ user, profile, role, error }) => {
    if (!isConfigured) { $('signed-out').classList.remove('hidden'); busy(true); return; }
    $('signed-out').classList.toggle('hidden', !!user);
    $('signed-in').classList.toggle('hidden', !user);
    if (!user) return;

    $('me-email').textContent = user.email || '—';
    $('me-role').replaceChildren(roleTag(role));
    const status = $('me-status');
    const actions = $('me-actions');
    status.replaceChildren();
    actions.replaceChildren();

    const isPasswordUser = user.providerData.some((p) => p.providerId === 'password');
    if (error) {
        status.append(el('div', { class: 'notice error', text: 'Could not load your profile: ' + friendlyError(error) }));
    } else if (!user.emailVerified && isPasswordUser) {
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
    } else if (role === 'pending') {
        status.append(el('div', { class: 'notice' },
            el('strong', { text: 'Waiting for approval. ' }),
            'An administrator must grant you the moderator role. Send them the e-mail address shown above.'));
    } else if (role === 'disabled') {
        status.append(el('div', { class: 'notice error', text: 'This account has been disabled by an administrator.' }));
    } else if (isEditorRole(role)) {
        if (next) { location.replace(next); return; }
        status.append(el('div', { class: 'notice ok', text: 'You are signed in.' }));
        actions.append(el('a', { class: 'btn primary', href: 'editor.html', text: 'Open page editor' }));
        if (isAdminRole(role)) actions.append(el('a', { class: 'btn', href: 'admin.html', text: 'Admin panel' }));
    }
    actions.append(el('button', { class: 'btn danger', text: 'Sign out', onclick: () => logout() }));
    if (profile && profile.displayName) $('me-email').textContent = `${profile.displayName} <${user.email}>`;
});
