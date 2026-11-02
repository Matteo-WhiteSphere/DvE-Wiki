// Builds the Italian civil war pages of the wiki from the mod files
// (https://github.com/ECModder/2025-Dragon-Vs.-Eagle).
//
//   npm run sync-mod -- ../2025-Dragon-Vs.-Eagle      (countries, ideologies: run it first)
//   npm run sync-italy -- ../2025-Dragon-Vs.-Eagle    (this script)
//
// Reads the civil war script (common/scripted_effects/DVE_ITA_civil_war_effects.txt),
// the history, localisation, events and national focus trees of ITA, INT, SRI, RSI,
// LOM and TYR, and writes 7 pages into data/placeholders.json (slugs ita_civil_war and
// ita_cw_*). They are shown as "generated from the mod" until an editor saves a
// version of them from the web editor. Other slugs of that file are not touched.
import { readdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { readText, parse, all, first, val, deep, effective, parseLocalisation, plainLoc } from './hoi4-parser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MOD = resolve(process.argv[2] || join(root, '..', '2025-Dragon-Vs.-Eagle'));
if (!existsSync(join(MOD, 'descriptor.mod'))) {
    console.error(`Mod not found in ${MOD}. Usage: npm run sync-italy -- <path to the mod repository>`);
    process.exit(1);
}
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const GROUP = 'ita_cw';
const START = '2025.1.1.12';

// ------------------------------------------------------------ helpers
const loc = new Map();
(function walk(dir) {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, f.name);
        if (f.isDirectory()) walk(p);
        else if (f.name.endsWith('.yml') && /l_english/.test(f.name)) parseLocalisation(readText(p), loc);
    }
})(join(MOD, 'localisation'));
const L = (key) => plainLoc(loc.get(key) || '');
/** Localised text for the wiki: one line, no scripted [placeholders]. */
const text = (key) => {
    const raw = loc.get(key);
    if (!raw) return '';
    return plainLoc(raw.replace(/\\n/g, ' ').replace(/\[[^\]]*\]/g, '')).replace(/\s+/g, ' ').trim();
};
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
const mdTable = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');

const ideologies = readJson('data/ideologies.json').ideologies;
const ideologyOf = new Map();
const subName = new Map();
for (const i of ideologies) for (const t of i.types) { ideologyOf.set(t.key, i); subName.set(t.key, t.name); }
const ideologyByKey = new Map(ideologies.map((i) => [i.key, i]));
const sub = (k) => subName.get(k) || String(k || '').replace(/_/g, ' ');

const stateName = (id) => {
    const l = L(`STATE_${id}`);
    if (l) return l;
    const f = readdirSync(join(MOD, 'history/states')).find((x) => x.startsWith(id + '-'));
    return f ? f.replace(/^\d+-/, '').replace(/\.txt$/, '') : `State ${id}`;
};

let commit = '';
try { commit = execFileSync('git', ['-C', MOD, 'log', '-1', '--format=%h'], { encoding: 'utf8' }).trim(); } catch { /* not a git checkout */ }

// ------------------------------------------------- civil war script
const cwFile = join(MOD, 'common/scripted_effects/DVE_ITA_civil_war_effects.txt');
const cwRaw = readText(cwFile);
const cwTree = parse(cwRaw);

/** Text of the top-level block "name = { ... }" (braces balanced). */
function block(raw, name) {
    const m = new RegExp(`(^|\\n)${name}\\s*=\\s*\\{`).exec(raw);
    if (!m) return '';
    let depth = 0, i = m.index + m[0].length - 1;
    const start = i;
    for (; i < raw.length; i++) {
        if (raw[i] === '{') depth++;
        else if (raw[i] === '}' && --depth === 0) break;
    }
    return raw.slice(start, i + 1);
}

const TAGS = ['ITA', 'INT', 'SRI', 'RSI', 'LOM', 'TYR'];
const territory = {};
const capital = {};
for (const tag of TAGS.slice(1)) {
    const b = block(cwRaw, `ITA_cw_spawn_${tag}_effect`);
    territory[tag] = [...new Set([...b.split('every_owned_state')[1]?.matchAll(/state = (\d+)/g) || []].map((m) => Number(m[1])))];
    const cap = /set_capital = \{ state = (\d+)/.exec(b);
    capital[tag] = cap ? Number(cap[1]) : null;
}
// ITA keeps every state that no list names.
const italyStates = [];
for (const f of readdirSync(join(MOD, 'history/states'))) {
    const st = val(parse(readText(join(MOD, 'history/states', f))), 'state');
    if (val(val(st, 'history'), 'owner') === 'ITA') italyStates.push(Number(val(st, 'id')));
}
const taken = new Set(Object.values(territory).flat());
territory.ITA = italyStates.filter((s) => !taken.has(s)).sort((a, b) => a - b);
capital.ITA = 2;
const CITY = { ITA: 'Rome', INT: 'Genoa', SRI: 'Naples', RSI: 'Latina', LOM: 'Veneto', TYR: 'Bolzano / Bozen' };
const capitalName = (tag) => `${CITY[tag]} (state ${stateName(capital[tag])}, ${capital[tag]})`;
const stateList = (tag) => territory[tag].map((s) => `${stateName(s)} (${s})`).join(', ');

// Templates and divisions created at the outbreak.
const templates = new Map();
for (const e of deep(cwTree, 'division_template')) {
    const name = val(e.value, 'name');
    const regs = (all(e.value, 'regiments')[0]?.value || []).filter((r) => r.key);
    const sup = (all(e.value, 'support')[0]?.value || []).filter((r) => r.key);
    if (!name || !regs.length || templates.has(name)) continue;
    const count = (list) => { const m = {}; for (const r of list) m[r.key] = (m[r.key] || 0) + 1; return Object.entries(m).map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`).join(', '); };
    templates.set(name, [count(regs), count(sup)].filter(Boolean).join(' + '));
}
const army = {};
for (const e of deep(cwTree, 'create_unit')) {
    const owner = val(e.value, 'owner');
    const div = val(e.value, 'division') || '';
    const tpl = /division_template = \\"([^\\"]+)\\"/.exec(div)?.[1];
    const exp = /start_experience_factor = ([\d.]+)/.exec(div)?.[1];
    const eq = /start_equipment_factor = ([\d.]+)/.exec(div)?.[1];
    const n = Number(val(e.value, 'count') || 1);
    if (!owner || !tpl) continue;
    const a = (army[owner] ||= { total: 0, templates: new Map() });
    a.total += n;
    const t = a.templates.get(tpl) || { n: 0, exp, eq };
    t.n += n;
    a.templates.set(tpl, t);
}

// Wars declared when the civil war breaks out.
const warBlock = block(cwRaw, 'ITA_civil_war_effect');
const wars = [];
for (const m of warBlock.matchAll(/limit = \{ country_exists = (\w+) \} declare_war_on = \{ target = (\w+)/g)) wars.push(['ITA', m[2]]);
for (const m of warBlock.matchAll(/\n\s*(\w+) = \{ declare_war_on = \{ target = (\w+)/g)) wars.push([m[1], m[2]]);

// ------------------------------------------------- country data
const histFile = (tag) => readdirSync(join(MOD, 'history/countries')).find((f) => f.startsWith(tag + ' - '));
const characters = new Map();
for (const f of readdirSync(join(MOD, 'common/characters'))) {
    for (const e of val(parse(readText(join(MOD, 'common/characters', f))), 'characters') || []) characters.set(e.key, e.value);
}
const tagNames = { INT: 'The Internationale' };
function country(tag) {
    const h = parse(readText(join(MOD, 'history/countries', histFile(tag))));
    const politics = effective(h, 'set_politics', START).pop()?.value;
    const ruling = val(politics, 'ruling_party');
    const pop = effective(h, 'set_popularities', START).pop()?.value || [];
    const parties = {};
    for (const e of effective(h, 'set_party_name', START)) parties[val(e.value, 'ideology')] = { name: val(e.value, 'name'), long: val(e.value, 'long_name') };
    const leaders = [];
    for (const e of [...effective(h, 'create_country_leader', START), ...effective(h, 'recruit_character', START)]) {
        if (e.key === 'create_country_leader' && Array.isArray(e.value)) leaders.push({ name: val(e.value, 'name'), ideology: val(e.value, 'ideology') });
        else if (e.key === 'recruit_character') {
            const c = characters.get(e.value);
            const cl = c && val(c, 'country_leader');
            if (cl) leaders.push({ name: L(val(c, 'name')) || val(c, 'name'), ideology: val(cl, 'ideology') });
        }
    }
    const num = (k) => { const v = effective(h, k, START).pop(); return v ? Number(v.value) : null; };
    return {
        tag, name: L(tag) || tagNames[tag] || tag, adj: L(`${tag}_ADJ`), ruling,
        popularity: Object.fromEntries(pop.filter((e) => e.key).map((e) => [e.key, Number(e.value)])),
        parties, leaders,
        stability: num('set_stability'), warSupport: num('set_war_support'), research: num('set_research_slots')
    };
}

// ------------------------------------------------- focus trees
const BRANCH = { eco: 'Economy', pol: 'Politics', for: 'Foreign policy', mil: 'Military', cw: 'Civil war' };

function focusTree(fileName, treeId) {
    const t = parse(readText(join(MOD, 'common/national_focus', fileName)));
    const tree = all(t, 'focus_tree').find((x) => val(x.value, 'id') === treeId);
    if (!tree) return [];
    const list = all(tree.value, 'focus').map((f) => {
        const id = val(f.value, 'id');
        const groups = all(f.value, 'prerequisite').map((p) => all(p.value, 'focus').map((x) => x.value));
        const excl = all(f.value, 'mutually_exclusive').flatMap((p) => all(p.value, 'focus').map((x) => x.value));
        const name = L(id) || id;
        let desc = text(`${id}_desc`);
        // The mod has generic stand-ins ("<Focus name> focus for Italy.", "[Description to be written.]").
        if (/to be written/i.test(loc.get(`${id}_desc`) || '') || desc.toLowerCase().startsWith(`${name.toLowerCase()} focus for`)) desc = '';
        return { id, name, desc, groups, excl, x: Number(val(f.value, 'x') || 0), y: Number(val(f.value, 'y') || 0) };
    });
    const byId = new Map(list.map((f) => [f.id, f]));
    const tierOf = (f, seen = new Set()) => {
        if (f.tier) return f.tier;
        if (seen.has(f.id)) return 1; // cycle guard
        seen.add(f.id);
        let tier = 1;
        for (const g of f.groups) {
            const ts = g.map((id) => byId.get(id)).filter(Boolean).map((p) => tierOf(p, new Set(seen)));
            if (ts.length) tier = Math.max(tier, 1 + Math.min(...ts));
        }
        return (f.tier = tier);
    };
    for (const f of list) tierOf(f);
    return list;
}

function focusRow(f, all_, withDesc) {
    const byId = new Map(all_.map((x) => [x.id, x]));
    const dup = new Map();
    for (const x of all_) dup.set(x.name, (dup.get(x.name) || 0) + 1);
    // Several focuses can share a name (mirror choices): show the id then.
    const nm = (id) => { const x = byId.get(id); return !x ? id : dup.get(x.name) > 1 ? `${x.name} (${id})` : x.name; };
    const req = f.groups.map((g) => g.map(nm).join(' or ')).join(' + ');
    const lines = [];
    if (req) lines.push(`Requires: ${req}`);
    if (f.excl.length) lines.push(`Excludes: ${f.excl.map(nm).join(', ')}`);
    const row = [`**${f.name}**<br>\`${f.id}\``, String(f.tier), lines.join('<br>') || '—'];
    if (withDesc) row.push(f.desc || '—');
    return row;
}

/** Table of focuses; the Description column is left out when the mod has no real descriptions for them. */
function focusTable(fs, all_) {
    const withDesc = fs.filter((f) => f.desc).length >= fs.length * 0.2;
    const head = ['Focus', 'Tier', 'Requirements', ...(withDesc ? ['Description'] : [])];
    const sorted = [...fs].sort((a, b) => a.tier - b.tier || a.x - b.x || a.y - b.y);
    const note = withDesc ? '' : '> The mod has no descriptions for these focuses yet.\n\n';
    return note + mdTable(head, sorted.map((f) => focusRow(f, all_, withDesc)));
}

/** Splits a tree into branches (by id prefix) and returns wiki sections. */
function focusSections(list, title) {
    if (!list.length) return [];
    const keyOf = (n) => (f) => f.id.split('_').slice(0, n).join('_');
    let groups = null;
    for (const n of [2, 1]) {
        const g = new Map();
        for (const f of list) { const k = keyOf(n)(f); (g.get(k) || g.set(k, []).get(k)).push(f); }
        const big = [...g.values()].filter((v) => v.length >= 3);
        const covered = big.reduce((s, v) => s + v.length, 0);
        if (big.length >= 2 && covered >= list.length * 0.6) { groups = g; break; }
    }
    const sections = [];
    if (!groups) {
        const sorted = [...list].sort((a, b) => a.tier - b.tier || a.x - b.x || a.y - b.y);
        for (let i = 0; i < sorted.length; i += 40) {
            const part = sorted.slice(i, i + 40);
            const label = sorted.length <= 40 ? `${title} (${sorted.length} focuses)` : `${title} — focuses ${i + 1}-${i + part.length}`;
            sections.push({ title: label, layout: 'full', body: focusTable(part, list) });
        }
        return sections;
    }
    const main = [];
    const branches = [];
    for (const [k, fs] of groups) (fs.length >= 3 ? branches.push([k, fs]) : main.push(...fs));
    if (main.length) sections.push({ title: `${title} — main line (${main.length} focuses)`, layout: 'full', body: focusTable(main, list) });
    const byId = new Map(list.map((f) => [f.id, f]));
    // A branch is named after the focus it grows from (outside the branch); when several branches
    // grow from the same focus, each one is named after its own first focus.
    const info = branches.map(([k, fs]) => {
        const root = [...fs].sort((x, y) => x.tier - y.tier || x.x - y.x)[0];
        const parent = byId.get(root.groups[0]?.[0]);
        return { k, fs, root, parent: parent && !fs.includes(parent) ? parent : null };
    });
    for (const { k, fs, root, parent } of info) {
        const shared = parent && info.filter((i) => i.parent === parent).length > 1;
        const label = BRANCH[k.split('_').pop()] || (parent && !shared ? `${parent.name} branch` : `${root.name} branch`);
        sections.push({ title: `${title} — ${label} (${fs.length} focuses)`, layout: 'full', body: focusTable(fs, list) });
    }
    return sections;
}

// ------------------------------------------------- page builders
const ideoName = (k) => ideologyByKey.get(k)?.name || k;
const colorOf = (k) => ideologyByKey.get(k)?.color || '#3cdf5f';

function landscape(c) {
    const rows = ideologies.map((i) => {
        const p = c.parties[i.key];
        return { pop: c.popularity[i.key] ?? 0, row: [i.name, p ? p.name || '—' : '—', p && p.long && p.long !== 'no_party' ? p.long : '—', `${c.popularity[i.key] ?? 0}%`] };
    }).sort((a, b) => b.pop - a.pop);
    return mdTable(['Ideology', 'Party', 'Full name', 'Popularity (start)'], rows.map((r) => r.row));
}

function governmentNames(tag) {
    const rows = ideologies.map((i) => [i.name, L(`${tag}_${i.key}`) || '—']).filter((r) => r[1] !== '—');
    return rows.length ? mdTable(['Ideology', 'Name of the state'], rows) : '';
}

function leadersTable(c) {
    if (!c.leaders.length) return '';
    return mdTable(['Leader', 'Sub-ideology', 'Ideology'], c.leaders.filter((l) => l.name).map((l) => [l.name, sub(l.ideology), ideologyOf.get(l.ideology)?.name || '—']));
}

function armyTable(tag) {
    const a = army[tag];
    if (!a) return '';
    return mdTable(['Division template', 'Divisions', 'Composition', 'Experience', 'Equipment'],
        [...a.templates].map(([n, t]) => [n, t.n, templates.get(n) || '—', t.exp ? `${Math.round(t.exp * 100)}%` : '—', t.eq ? `${Math.round(t.eq * 100)}%` : '—']));
}

const WAR_TEXT = (tag) => {
    const against = wars.filter(([a]) => a === tag).map(([, b]) => b);
    const by = wars.filter(([, b]) => b === tag).map(([a]) => a);
    const lines = [];
    if (against.length) lines.push(`- Declares war on: ${against.join(', ')}`);
    if (by.length) lines.push(`- War declared on it by: ${by.join(', ')}`);
    if (!against.length) lines.push('- Declares no war: it wants independence, not the rest of Italy.');
    return lines.join('\n');
};

const FACTIONS = {
    ITA: { slug: 'ita_cw_ita', label: 'Italy (ITA)', order: 1, short: 'Armed Forces Joint Command', tree: ['italy.txt', 'italian_focus'], about:
        'The legitimate state. Italy keeps Rome and every state that no other faction receives, leaves its military alliance, and loses 30% stability. Two days after the outbreak the only institution still able to give orders, the Armed Forces Joint Command (F.F.A.A.), takes power in Rome and turns the government into a military dictatorship.' },
    INT: { slug: 'ita_cw_int', label: 'Internationale (INT)', order: 2, short: 'Lotta Comunista and the revolutionary left', tree: ['INT_focus.txt', 'INT_focus'], treeCw: ['INT_civil_war.txt', 'INT_civil_war_focus'], about:
        'Italy\'s own revolution: the unions and the revolutionary left, led by Lotta Comunista and the Vanguard-Revolutionary Front. It holds the industrial north, starts in Genoa and moves its capital to Milan once the war is won. It has cores on all of Italy, founds the international organisation "The International", and is the only faction with a civil war focus tree plus a large post-war tree.' },
    SRI: { slug: 'ita_cw_sri', label: 'Socialist Republic (SRI)', order: 3, short: 'PdRC-PaP Front (Stalinist)', tree: ['SRI_focus.txt', 'SRI_focus'], about:
        'The Stalinist front (PdRC-PaP, later the unified PCI-U) ruling from Naples. It is the rival socialist current of the Internationale: the two fight each other as well as the fascists.' },
    RSI: { slug: 'ita_cw_rsi', label: 'Social Republic (RSI)', order: 4, short: 'Fascist Front', tree: ['RSI_focus.txt', 'RSI_focus'], about:
        'The fascist front, with a single state (Latina) and a militia army. It claims Rome as its capital without ever fully controlling it. It is attacked by Italy, by the Internationale and by the Socialist Republic.' },
    LOM: { slug: 'ita_cw_lom', label: 'Padania (LOM)', order: 5, short: 'Northern separatists', tree: ['LOM_focus.txt', 'LOM_focus'], about:
        'The northern separatists (Lega Nord tradition) holding Veneto and eastern Lombardy. Padania only fights the legitimate government and has a large focus tree with six ideological paths.' },
    TYR: { slug: 'ita_cw_tyr', label: 'South Tyrol (TYR)', order: 6, short: 'German-speaking separatists', tree: null, about:
        'The German-speaking separatists of Alto Adige / South Tyrol (Süd-Tiroler Freiheit, led by Sven Knoll). One state and four Schützen divisions; like Padania it fights only the government in Rome. It has no focus tree yet.' }
};

function factionPage(tag) {
    const F = FACTIONS[tag];
    const c = country(tag);
    const ruling = c.ruling;
    const cap = capital[tag];
    const info = [
        `**TAG:** \`${tag}\`  `,
        `**Name:** ${c.name}${c.adj ? ` (${c.adj})` : ''}  `,
        `**Role in the civil war:** ${F.short}  `,
        `**Starting ideology:** ${ideoName(ruling)}  `,
        `**Capital:** ${capitalName(tag)}${tag === 'INT' ? '; moves to Milan (159) once the civil war is won' : ''}  `,
        `**States at the outbreak:** ${territory[tag].length}  `,
        `**Divisions at the outbreak:** ${army[tag]?.total ?? 0}  `,
        c.stability != null ? `**Stability / war support / research slots:** ${Math.round(c.stability * 100)}% / ${Math.round(c.warSupport * 100)}% / ${c.research}` : ''
    ].filter(Boolean).join('\n');

    const sections = [
        { title: 'Country Information', layout: 'full', body: `${F.about}\n\n${info}` },
        { title: 'Territory and war', layout: 'full', body: [`**States (${territory[tag].length}):** ${stateList(tag)}`, '', WAR_TEXT(tag)].join('\n') }
    ];
    const armyMd = armyTable(tag);
    if (armyMd) sections.push({ title: 'Army at the outbreak', layout: 'full', body: armyMd });
    sections.push({ title: 'Political Landscape', layout: 'full', body: landscape(c) });
    const leaders = leadersTable(c);
    if (leaders) sections.push({ title: 'Available Leaders', layout: 'half', body: leaders });
    const names = governmentNames(tag);
    if (names) sections.push({ title: 'Name of the State by Ideology', layout: 'half', body: names });

    if (F.treeCw) sections.push(...focusSections(focusTree(...F.treeCw), 'Civil war focus tree'));
    if (F.tree) {
        const list = focusTree(...F.tree);
        sections.push(...focusSections(list, tag === 'ITA' ? 'Italian focus tree' : tag === 'INT' ? 'Post-war focus tree' : 'Focus tree'));
    } else {
        sections.push({ title: 'Focus tree', layout: 'full', body: 'South Tyrol has no national focus tree yet.' });
    }
    const ide = ideologyByKey.get(ruling);
    return {
        title: `${c.name.toUpperCase()} (${tag})`, subtitle: `Italian Civil War · ${F.short}`, category: 'path', group: GROUP, tag,
        accent: ide ? ide.color : '#3cdf5f', navOrder: F.order, navLabel: F.label,
        ideology: '', subIdeology: '', ideologyColor: '', generated: true, sections
    };
}

function overviewPage() {
    const c = Object.fromEntries(TAGS.map((t) => [t, country(t)]));
    const ev = (id) => `**${text(`${id}.t`)}**\n> ${text(`${id}.d`)}`;
    const facTable = mdTable(['Tag', 'Faction', 'Starting ideology', 'Capital', 'States', 'Divisions', 'Page'],
        TAGS.map((t) => [t, c[t].name, ideoName(c[t].ruling), CITY[t], territory[t].length, army[t]?.total ?? 0,
            `[${FACTIONS[t].label}](page.html?p=${FACTIONS[t].slug})`]));
    const partition = mdTable(['Faction', 'States'], TAGS.map((t) => [`**${t}** (${territory[t].length})`, stateList(t)]));
    const war = mdTable(['Who declares war', 'On whom', 'Why'], wars.map(([a, b]) => [a, b, {
        ITA: 'The legitimate government against whoever has broken away',
        INT: b === 'RSI' ? 'Communists against fascists' : 'The two rival socialist currents'
    }[a] || 'Communists against fascists']));
    const sections = [
        { title: 'Overview', layout: 'full', body: [
            'When the Italian civil war breaks out, the Republic splits into **six factions**: the government in Rome (ITA), the revolutionary left (INT), the Stalinist front (SRI), the fascists (RSI) and two separatist movements, Padania (LOM) and South Tyrol (TYR). The 35 Italian states are divided between them at once, each faction receives its own army, and the wars are declared.',
            '',
            '- Italy leaves its military alliance, loses 30% stability and gains 10% war support.',
            '- Two days later the Armed Forces Joint Command (F.F.A.A.) takes power in Rome and turns the government into a military dictatorship.',
            '- A player who is Italy chooses which faction to play.',
            '- The Internationale has cores on all of Italy and founds the international organisation "The International".',
            '',
            '> **Development status:** in the current version of the mod the civil war can only be started from the debug decision `DVE_debug_italy_civil_war` and is not yet wired to a focus. The partition and the armies below are the ones the script applies.'
        ].join('\n') },
        { title: 'The Six Factions', layout: 'full', body: facTable },
        { title: 'Partition of the 35 States', layout: 'full', body: partition },
        { title: 'Who Fights Whom', layout: 'half', body: `${war}\n\nPadania and South Tyrol stay out of the ideological wars: they want independence, not the rest of the country.` },
        { title: 'Armies at the Outbreak', layout: 'half', body: mdTable(['Faction', 'Divisions', 'Template(s)'], TAGS.map((t) => [t, army[t]?.total ?? 0, [...(army[t]?.templates.keys() || [])].join(', ')])) },
        { title: 'Events', layout: 'full', body: [
            '**Before the war** (news events sent to every country, while Italy is not yet in its civil war)',
            '',
            ev('dve_itapro.1'), '', ev('dve_itapro.2'), '',
            '**When the war breaks out**',
            '',
            ev('dve_itacw.1'), '', ev('dve_itacw.2')
        ].join('\n') }
    ];
    return {
        title: 'ITALIAN CIVIL WAR', subtitle: 'Six factions · 35 states', category: 'guide', group: GROUP, tag: 'ITA',
        accent: '#3cdf5f', navOrder: 0, navLabel: 'Civil War', ideology: '', subIdeology: '', ideologyColor: '', generated: true, sections
    };
}

// ------------------------------------------------- write
const pages = { ita_civil_war: overviewPage() };
for (const tag of TAGS) pages[FACTIONS[tag].slug] = factionPage(tag);
for (const p of Object.values(pages)) p.source = { repository: 'https://github.com/ECModder/2025-Dragon-Vs.-Eagle', commit };

const seedsPath = join(root, 'data/placeholders.json');
const seeds = JSON.parse(readFileSync(seedsPath, 'utf8'));
for (const slug of Object.keys(seeds)) if (slug === 'ita_civil_war' || slug.startsWith('ita_cw_')) delete seeds[slug];
Object.assign(seeds, pages);
writeFileSync(seedsPath, JSON.stringify(seeds, null, 1) + '\n');

for (const [slug, p] of Object.entries(pages)) {
    console.log(`${slug.padEnd(14)} ${String(p.sections.length).padStart(2)} sections  ${(JSON.stringify(p).length / 1024).toFixed(0).padStart(4)} KB`);
}
console.log(`Mod commit ${commit || '(unknown)'} · states: ${TAGS.map((t) => `${t} ${territory[t].length}`).join(', ')} · wars: ${wars.length}`);
