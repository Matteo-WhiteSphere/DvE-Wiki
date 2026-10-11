// Minimal reader for Hearts of Iron IV script files (Paradox "clausewitz" format)
// and localisation .yml files. Used by tools/sync-from-mod.mjs.
import { readFileSync } from 'node:fs';

/** Reads a mod file as text (UTF-8 with or without BOM, falling back to Windows-1252). */
export function readText(path) {
    const buf = readFileSync(path);
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
    } catch {
        return new TextDecoder('windows-1252').decode(buf);
    }
}

function tokenize(src) {
    const tokens = [];
    const re = /\s+|#[^\n]*|"((?:[^"\\]|\\.)*)"|([{}])|(<=|>=|!=|==|[=<>])|([^\s{}=<>#"]+)/gy;
    let m;
    while (re.lastIndex < src.length && (m = re.exec(src))) {
        if (m[1] !== undefined) tokens.push({ t: 'str', v: m[1] });
        else if (m[2]) tokens.push({ t: m[2] });
        else if (m[3]) tokens.push({ t: 'op', v: m[3] });
        else if (m[4]) tokens.push({ t: 'word', v: m[4] });
    }
    return tokens;
}

/**
 * Parses a script into an array of entries. Each entry is { key, op, value }
 * (value = string or nested array) or { value } for bare list items.
 * Duplicate keys are kept, in order.
 */
export function parse(src) {
    const tokens = tokenize(src);
    let i = 0;
    function block() {
        const out = [];
        while (i < tokens.length) {
            const tok = tokens[i];
            if (tok.t === '}') { i++; return out; }
            if (tok.t === '{') { i++; out.push({ value: block() }); continue; }
            const next = tokens[i + 1];
            if (next && next.t === 'op') {
                i += 2;
                const val = tokens[i];
                if (!val) break;
                if (val.t === '{') { i++; out.push({ key: tok.v, op: next.v, value: block() }); }
                else { i++; out.push({ key: tok.v, op: next.v, value: val.v }); }
            } else {
                i++;
                if (tok.v !== undefined) out.push({ value: tok.v });
            }
        }
        return out;
    }
    return block();
}

export const all = (entries, key) => (entries || []).filter((e) => e.key === key);
export const first = (entries, key) => (entries || []).find((e) => e.key === key);
export const val = (entries, key) => { const e = first(entries, key); return e ? e.value : undefined; };

/** Every entry with this key, at any depth. */
export function deep(entries, key, out = []) {
    for (const e of entries || []) {
        if (e.key === key) out.push(e);
        if (Array.isArray(e.value)) deep(e.value, key, out);
    }
    return out;
}

const DATE_RE = /^(\d{1,4})\.(\d{1,2})\.(\d{1,2})(?:\.(\d{1,2}))?$/;
const dateValue = (d) => { const m = DATE_RE.exec(d); return m ? ((+m[1] * 100 + +m[2]) * 100 + +m[3]) * 100 + +(m[4] || 0) : null; };

/**
 * Entries with this key in the order the game applies a history file: first the
 * undated part (conditional blocks included), then dated blocks up to startDate.
 */
export function effective(entries, key, startDate) {
    const limit = dateValue(startDate) ?? Infinity;
    const out = [];
    const dated = [];
    (function walk(list) {
        for (const e of list || []) {
            const d = e.key && dateValue(e.key);
            if (d !== null && d !== undefined && Array.isArray(e.value)) { if (d <= limit) dated.push({ d, value: e.value }); continue; }
            if (e.key === key) out.push(e);
            if (Array.isArray(e.value)) walk(e.value);
        }
    })(entries);
    for (const { value } of dated.sort((a, b) => a.d - b.d)) out.push(...effective(value, key, startDate));
    return out;
}

/** Localisation lines: ` key:0 "text"` → Map(key → text). */
export function parseLocalisation(src, map = new Map()) {
    for (const line of src.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z0-9_.\-]+):\d*\s*"(.*)"\s*(#.*)?$/);
        if (m && !map.has(m[1])) map.set(m[1], m[2].replace(/\\"/g, '"'));
    }
    return map;
}

/** Removes HOI4 formatting codes (§Y…§!, [scripted], £icons) from a localised string. */
export function plainLoc(s) {
    return String(s || '').replace(/§[A-Za-z!]/g, '').replace(/£\S+/g, '').replace(/\\n/g, ' ').trim();
}
