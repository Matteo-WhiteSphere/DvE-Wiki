// Emergency password reset with the DVE_RECOVERY_CODE set in Netlify.
import { api, el, friendlyError, USERNAME_RE } from './wiki.js';

const $ = (id) => document.getElementById(id);

function notice(text, kind = '') {
    $('recover-notice').replaceChildren(text ? el('div', { class: 'notice ' + kind, text }) : '');
}

$('recover-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const username = $('username').value.trim();
    if (!USERNAME_RE.test(username)) { notice('Write the username as Role.Name, e.g. Owner.RedMatteo.', 'error'); return; }
    $('recover-btn').disabled = true;
    try {
        const r = await api('recover', { method: 'POST', body: { code: $('code').value, username } });
        notice(null);
        $('recover-result').replaceChildren(
            el('strong', { text: 'Done. ' }), 'Sign in with these details; you will be asked to choose your own password.',
            el('pre', {}, el('code', { text: `Username: ${r.username}\nTemporary password: ${r.password}` })),
            el('a', { class: 'btn primary', href: 'login.html', text: 'Go to login' }));
        $('recover-result').classList.remove('hidden');
        $('username').value = '';
    } catch (e) {
        notice(friendlyError(e), 'error');
    } finally { $('recover-btn').disabled = false; }
});
