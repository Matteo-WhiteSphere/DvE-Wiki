// Aligns the wiki with the mod repository (https://github.com/ECModder/2025-Dragon-Vs.-Eagle).
//
//   git clone --depth 1 https://github.com/ECModder/2025-Dragon-Vs.-Eagle ../2025-Dragon-Vs.-Eagle
//   npm run sync-mod -- ../2025-Dragon-Vs.-Eagle
//
// Reads ideologies, countries on the 2025 map (state owners), ruling parties,
// leaders, popularities, party names and localisation, and rewrites:
//   data/ideologies.json   → ideologies.html and the search
//   data/countries.json    → home page country table (majors are kept, names/tags updated)
//   data/placeholders.json → draft pages of the countries (only countries never written
//                            in the editor show them; written pages are not touched)
//   data/mod-report.json   → data problems found in the mod (e.g. no leader for the ruling party)
// Run tools/convert-mod-icons.py afterwards to copy new ideology icons.
import { readdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readText, parse, val, deep, effective, parseLocalisation, plainLoc } from './hoi4-parser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MOD = resolve(process.argv[2] || join(root, '..', '2025-Dragon-Vs.-Eagle'));
if (!existsSync(join(MOD, 'descriptor.mod'))) {
    console.error(`Mod not found in ${MOD}. Usage: npm run sync-mod -- <path to the mod repository>`);
    process.exit(1);
}
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const writeJson = (p, data) => writeFileSync(join(root, p), JSON.stringify(data, null, 1) + '\n');
const hex = (rgb) => '#' + rgb.map((n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0')).join('');
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// ------------------------------------------------------------ localisation
const loc = new Map();
(function walk(dir) {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, f.name);
        if (f.isDirectory()) walk(p);
        else if (f.name.endsWith('.yml') && /l_english/.test(f.name)) parseLocalisation(readText(p), loc);
    }
})(join(MOD, 'localisation'));
const L = (key) => plainLoc(loc.get(key) || '');

/** Mod descriptions start with the title and an icon line: keep only the prose. */
function description(key) {
    const raw = loc.get(key);
    if (!raw) return '';
    return plainLoc(raw.replace(/^§H[^§]*§!/, '').replace(/£\S+/g, '').replace(/\\n/g, ' ').replace(/\[[^\]]*\]/g, '')).replace(/\s+/g, ' ').trim();
}

// Start date of the mod (first bookmark), used to apply dated history blocks.
let START = '2025.1.1.12';
if (existsSync(join(MOD, 'common/bookmarks'))) {
    for (const f of readdirSync(join(MOD, 'common/bookmarks')).sort()) {
        const d = deep(parse(readText(join(MOD, 'common/bookmarks', f))), 'date')[0];
        if (d) { START = d.value; break; }
    }
}

// --------------------------------------------------------------- ideologies
const ideologyBlock = val(parse(readText(join(MOD, 'common/ideologies/00_ideologies.txt'))), 'ideologies');
const icon = (key) => {
    for (const name of [key, key.toLowerCase()]) if (existsSync(join(root, 'images/ideologies', name + '.png'))) return `images/ideologies/${name}.png`;
    return '';
};
const art = (key) => existsSync(join(root, 'images/ideologies/art', key + '.jpg')) ? `images/ideologies/art/${key}.jpg` : '';
const ideologies = ideologyBlock.filter((e) => Array.isArray(e.value)).map((e) => {
    const color = (val(e.value, 'color') || []).map((x) => x.value);
    return {
        key: e.key,
        // The name shown in game in the politics screen (the "_noun" strings of the mod have typos).
        name: L(e.key) || e.key,
        noun: L(`${e.key}_noun`) || '',
        color: color.length === 3 ? hex(color) : '#888888',
        icon: icon(e.key),
        description: description(`${e.key}_desc`),
        types: (val(e.value, 'types') || []).filter((t) => t.key).map((t) => ({
            key: t.key, name: L(t.key) || t.key.replace(/_/g, ' '), description: description(`${t.key}_desc`), icon: icon(t.key), art: art(t.key)
        }))
    };
});
const ideologyOf = new Map();
for (const i of ideologies) for (const t of i.types) ideologyOf.set(t.key, i);
const typeName = (k) => { for (const i of ideologies) for (const t of i.types) if (t.key === k) return t.name; return k || ''; };

// ---------------------------------------------------------------- countries
const owners = new Map(); // tag → number of states
for (const f of readdirSync(join(MOD, 'history/states'))) {
    const state = val(parse(readText(join(MOD, 'history/states', f))), 'state');
    const owner = val(val(state, 'history'), 'owner');
    if (owner) owners.set(owner, (owners.get(owner) || 0) + 1);
}
const characters = new Map();
if (existsSync(join(MOD, 'common/characters'))) {
    for (const f of readdirSync(join(MOD, 'common/characters'))) {
        for (const e of val(parse(readText(join(MOD, 'common/characters', f))), 'characters') || []) characters.set(e.key, e.value);
    }
}
const historyFiles = readdirSync(join(MOD, 'history/countries'));
const report = { noLeaderForRulingParty: [], rulingPartyWithZeroPopularity: [], noPolitics: [], missingHistory: [] };

const modCountries = [];
for (const tag of [...owners.keys()].sort()) {
    const file = historyFiles.find((f) => f.startsWith(tag + ' - ') || f.startsWith(tag + '-'));
    if (!file) { report.missingHistory.push(tag); continue; }
    const short = file.replace(/\.txt$/, '').replace(/^[A-Z0-9]{3}\s*-\s*/, '').trim();
    const h = parse(readText(join(MOD, 'history/countries', file)));
    const politics = effective(h, 'set_politics', START).pop();
    const ruling = politics && val(politics.value, 'ruling_party');
    if (!ruling) report.noPolitics.push(tag);
    const leaders = [];
    for (const e of [...effective(h, 'create_country_leader', START), ...effective(h, 'recruit_character', START)]) {
        if (e.key === 'create_country_leader' && Array.isArray(e.value)) {
            leaders.push({ name: val(e.value, 'name'), ideology: val(e.value, 'ideology') });
        } else if (e.key === 'recruit_character') {
            const c = characters.get(e.value);
            const cl = c && val(c, 'country_leader');
            if (cl) leaders.push({ name: L(val(c, 'name')) || val(c, 'name'), ideology: val(cl, 'ideology') });
        }
    }
    // As in game, the last leader defined for a party is the one in charge.
    const leader = leaders.filter((l) => ideologyOf.get(l.ideology)?.key === ruling).pop();
    if (ruling && !leader) report.noLeaderForRulingParty.push(`${tag} (${short}): ruling ${ruling}`);
    const popTmp = effective(h, 'set_popularities', START).pop();
    const rulingPop = popTmp ? Number(val(popTmp.value, ruling) || 0) : null;
    if (ruling && rulingPop === 0) report.rulingPartyWithZeroPopularity.push(`${tag} (${short}): ruling ${ruling}`);
    const pop = effective(h, 'set_popularities', START).pop();
    const popularities = pop ? pop.value.filter((e) => e.key).map((e) => ({ ideology: e.key, value: Number(e.value) })).sort((a, b) => b.value - a.value) : [];
    const parties = {};
    for (const e of effective(h, 'set_party_name', START)) parties[val(e.value, 'ideology')] = { name: val(e.value, 'name'), long: val(e.value, 'long_name') };
    modCountries.push({
        tag, short, official: L(`${tag}_${ruling}`) || L(tag) || short, ruling, sub: leader ? leader.ideology : '',
        leader: leader ? leader.name : '', leaders, popularities, parties, states: owners.get(tag)
    });
}

// ----------------------------------------------- match with the wiki slugs
const oldCountries = readJson('data/countries.json');
const seeds = readJson('data/placeholders.json');
const slugOf = new Map(); // mod tag → existing page slug
const MANUAL = { // wiki ISO tag → mod tag, when names differ too much
    CHN: 'PRC', TWN: 'CHI', PRK: 'NKO', COD: 'COG', COG: 'RCG', SWZ: 'ESW', CIV: 'IVO', MKD: 'MAC',
    IRN: 'PER', MMR: 'BRM', THA: 'SIA', CPV: 'CBV'
};
const byName = new Map();
for (const c of modCountries) for (const n of [c.short, c.official, L(c.tag)]) if (n) byName.set(fold(n), c);
const unmatched = [];
for (const row of oldCountries.countries) {
    const m = /page\.html\?p=([a-z0-9_-]+)/.exec(row.href);
    const slug = m && m[1];
    // Names first: the wiki used ISO codes, and many differ from HOI4 tags (AUS = Austria in HOI4).
    let mod = (MANUAL[row.tag] && modCountries.find((c) => c.tag === MANUAL[row.tag])) ||
        byName.get(fold(row.name)) ||
        modCountries.find((c) => fold(c.short) && (fold(row.name).includes(fold(c.short)) || fold(c.short).includes(fold(row.name))));
    if (process.env.SYNC_DEBUG && mod) console.log(`match ${row.tag} ${row.name} → ${mod.tag} ${mod.short}`);
    if (mod && !slugOf.has(mod.tag)) slugOf.set(mod.tag, { slug, href: row.href, major: row.major, name: row.name });
    else unmatched.push(`${row.tag} ${row.name}${mod ? ' (duplicate of ' + mod.tag + ')' : ''}`);
}
report.wikiCountriesNotInMod = unmatched;

// ------------------------------------------------------------ countries.json
const majorsByGroup = new Map(oldCountries.majors.map((m) => [m.group, m]));
const usedSlugs = new Set([...slugOf.values()].map((k) => k.slug));
for (const s of Object.keys(seeds)) if (seeds[s].category !== 'country') usedSlugs.add(s);
const countries = modCountries.map((c) => {
    const ide = ideologies.find((i) => i.key === c.ruling);
    const known = slugOf.get(c.tag);
    let slug = known && known.slug;
    if (!slug) {
        slug = c.tag.toLowerCase();
        if (usedSlugs.has(slug)) slug = `${slug}_${fold(c.short).replace(/ /g, '_')}`.slice(0, 64);
        usedSlugs.add(slug);
    }
    return {
        // In-game name (localisation of the ruling ideology); short name for sorting and search.
        tag: c.tag, name: c.official, short: (known && known.name) || c.short,
        ...(known && known.name && fold(known.name) !== fold(c.short) ? { alias: c.short } : {}),
        ideology: ide ? ide.name : c.ruling || '', ideologyKey: c.ruling || '',
        ideologyColor: ide ? ide.color : '#888888',
        subIdeology: c.sub ? typeName(c.sub) : '', subIdeologyKey: c.sub || '',
        leader: c.leader,
        href: known ? known.href : `page.html?p=${slug}`,
        ...(known && known.major ? { major: true } : {})
    };
});
// Majors keep their custom cards; tag and name follow the mod.
const majors = oldCountries.majors.map((m) => {
    const row = countries.find((c) => c.major && c.href === m.paths[0]?.href) || countries.find((c) => c.major && c.tag === m.tag);
    return row ? { ...m, tag: row.tag, name: row.name || m.name } : m;
});
writeJson('data/countries.json', {
    _comment: 'Generated by tools/sync-from-mod.mjs from the mod repository (do not edit by hand: run the sync again). ' +
        'Pages created in the editor are added on top by the home page.',
    source: { repository: 'https://github.com/ECModder/2025-Dragon-Vs.-Eagle', generated: new Date().toISOString() },
    majors, countries
});

// ------------------------------------------------------------ ideologies.json
const startingBy = new Map();
for (const c of countries) if (c.subIdeologyKey) {
    if (!startingBy.has(c.subIdeologyKey)) startingBy.set(c.subIdeologyKey, []);
    startingBy.get(c.subIdeologyKey).push({ tag: c.tag, name: c.short, href: c.href });
}
writeJson('data/ideologies.json', {
    _comment: 'Generated by tools/sync-from-mod.mjs from common/ideologies and localisation of the mod.',
    ideologies: ideologies.map((i) => ({
        ...i,
        countries: countries.filter((c) => c.ideologyKey === i.key).map((c) => ({ tag: c.tag, name: c.short, href: c.href })),
        types: i.types.map((t) => ({ ...t, countries: startingBy.get(t.key) || [] }))
    }))
});

// ---------------------------------------------------------- placeholders.json
// Country drafts are rebuilt from the mod; path pages (usa_democratic…) are kept.
const newSeeds = {};
for (const [slug, s] of Object.entries(seeds)) if (s.category !== 'country') newSeeds[slug] = s;
for (const c of modCountries) {
    const row = countries.find((r) => r.tag === c.tag);
    if (row.major) continue; // majors have their path pages
    c.short = row.short;
    const slug = /page\.html\?p=([a-z0-9_-]+)/.exec(row.href)?.[1];
    if (!slug) continue;
    const ide = ideologies.find((i) => i.key === c.ruling);
    const pops = c.popularities.map((p) => {
        const i = ideologies.find((x) => x.key === p.ideology);
        const party = c.parties[p.ideology];
        return `| ${i ? i.name : p.ideology} | ${party && party.long && party.long !== 'no_party' ? `${party.long}${party.name ? ` (${party.name})` : ''}` : '—'} | ${p.value}% |`;
    });
    const leaders = c.leaders.filter((l) => l.name).map((l) => `| ${l.name} | ${typeName(l.ideology)} | ${ideologyOf.get(l.ideology)?.name || '—'} |`);
    const sections = [
        { title: 'Country Information', layout: 'full', body: [
            `**TAG:** \`${c.tag}\`  `, `**Official name:** ${c.official}  `,
            `**Starting ideology:** ${ide ? ide.name : c.ruling || '—'}  `,
            `**Sub-ideology:** ${c.sub ? typeName(c.sub) : '—'}  `,
            `**Leader:** ${c.leader || '—'}  `, `**States at start:** ${c.states}`].join('\n') }
    ];
    if (pops.length) sections.push({ title: 'Political Landscape (2025)', layout: 'half', body: ['| Ideology | Party | Popularity |', '|---|---|---|', ...pops].join('\n') });
    if (leaders.length) sections.push({ title: 'Available Leaders', layout: 'half', body: ['| Leader | Sub-ideology | Ideology |', '|---|---|---|', ...leaders].join('\n') });
    newSeeds[slug] = {
        title: c.official.toUpperCase(), subtitle: '2025 Starting Country Overview', category: 'country',
        group: slug, tag: c.tag.slice(0, 4), accent: ide ? ide.color : '#00f3ff', navOrder: 0, navLabel: c.short,
        ideology: ide ? ide.name : '', subIdeology: c.sub ? typeName(c.sub) : '', ideologyColor: ide ? ide.color : '',
        sections
    };
}
writeJson('data/placeholders.json', newSeeds);
writeJson('data/mod-report.json', { generated: new Date().toISOString(), ...report });

console.log(`Ideologies: ${ideologies.length} (${ideologies.reduce((n, i) => n + i.types.length, 0)} sub-ideologies)`);
console.log(`Countries on the 2025 map: ${countries.length} (${[...slugOf.keys()].length} matched to existing wiki pages)`);
if (unmatched.length) console.log(`Wiki countries not found on the mod's 2025 map: ${unmatched.join(', ')}`);
console.log(`Draft pages: ${Object.keys(newSeeds).length}`);
console.log(`Mod data warnings: ${report.noLeaderForRulingParty.length} countries without a leader for the ruling party, ` +
    `${report.rulingPartyWithZeroPopularity.length} whose ruling party has 0% popularity, ` +
    `${report.noPolitics.length} without set_politics (see data/mod-report.json). Start date ${START}.`);
