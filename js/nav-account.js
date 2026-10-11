// "Login" button in the navigation bar of the static pages: shows the signed-in
// account and leads staff straight to the editor.
import { currentUser, isEditorRole } from './wiki.js';

const link = document.getElementById('nav-login');
if (link) {
    currentUser().then((user) => {
        if (!user) return; // keeps the plain "Login" link
        link.textContent = '\u{1F464} ' + user.username;
        link.href = isEditorRole(user.role) && !user.mustChangePassword ? 'editor.html' : 'login.html';
        link.title = `Signed in as ${user.username} (${user.role})`;
    });
}
