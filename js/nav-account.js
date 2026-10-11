// "Login" button in the navigation bar of the static pages: shows the signed-in
// account and leads staff straight to the editor.
import { isConfigured, watchSession, accountLabel, isEditorRole } from './wiki.js';

const link = document.getElementById('nav-login');
if (link && isConfigured) {
    watchSession(({ user, profile, role }) => {
        if (!user) {
            link.textContent = '\u{1F464} Login';
            link.href = 'login.html';
            link.title = 'Sign in (staff and user accounts)';
            return;
        }
        const label = accountLabel(profile, user) || 'Account';
        link.textContent = '\u{1F464} ' + label;
        link.href = isEditorRole(role) && profile && !profile.mustChangePassword ? 'editor.html' : 'login.html';
        link.title = `Signed in as ${label} (${role})`;
    });
}
