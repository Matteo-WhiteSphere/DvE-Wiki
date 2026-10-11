// Generates temporary passwords for the staff accounts and writes their HASHES into
// data/staff-accounts.json (the repository is public: never put real passwords there).
// The readable passwords are printed here once: send them privately, they must be
// changed at the first login. After the next deploy the site applies them.
//
//   node tools/temp-passwords.mjs                     every account in the file
//   node tools/temp-passwords.mjs Editor.Rapha        only some accounts (new ones are added)
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { hashPassword, tempPassword, parseUsername } from '../netlify/lib/core.mjs';

const file = fileURLToPath(new URL('../data/staff-accounts.json', import.meta.url));
const data = JSON.parse(await readFile(file, 'utf8'));
const entries = (data.accounts || []).map((a) => (typeof a === 'string' ? { username: a } : a));

const wanted = process.argv.slice(2);
for (const name of wanted) {
    const parsed = parseUsername(name);
    if (!parsed) { console.error(`"${name}" is not a valid username (Owner.Name, Admin.Name, Editor.Name).`); process.exit(1); }
    if (!entries.some((e) => e.username.toLowerCase() === parsed.username.toLowerCase())) entries.push({ username: parsed.username });
}

const reset = new Date().toISOString();
const out = [];
for (const e of entries) {
    if (wanted.length && !wanted.some((w) => w.toLowerCase() === e.username.toLowerCase())) continue;
    const password = tempPassword();
    e.tempPassword = await hashPassword(password);
    e.reset = reset;
    out.push([e.username, password]);
}

data._comment = 'Staff accounts. tempPassword is the HASH of a temporary password (made with tools/temp-passwords.mjs); ' +
    'the site applies it once for every new "reset" value, and the password must be changed at the next login. ' +
    'Never write real passwords in this file: the repository is public.';
data.accounts = entries;
await writeFile(file, JSON.stringify(data, null, 2) + '\n');

const width = Math.max(...out.map(([u]) => u.length));
console.log('\nTemporary passwords (shown only now — send them privately):\n');
for (const [u, p] of out) console.log(`  ${u.padEnd(width)}   ${p}`);
console.log('\nCommit data/staff-accounts.json and deploy: the site applies them at the next start.\n');
