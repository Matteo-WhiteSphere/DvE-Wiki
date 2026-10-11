// Local development server: serves the static site and the /api function, with a
// local database in .dev-data/ (same API as Netlify Blobs). No Netlify account needed.
//
//   npm install
//   npm run dev            → http://localhost:8888
//
// On the first request the accounts in data/staff-accounts.json are created and
// their temporary passwords are printed here, exactly like in the Netlify log.
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setEnvironmentContext } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8888);
const dataDir = resolve(process.env.DVE_DATA_DIR || join(root, '.dev-data'));

await mkdir(dataDir, { recursive: true });
const token = 'local-dev';
const blobs = new BlobsServer({ directory: dataDir, port: 0, token });
const { port: blobsPort } = await blobs.start();
const blobsURL = `http://127.0.0.1:${blobsPort}`;
setEnvironmentContext({ edgeURL: blobsURL, uncachedEdgeURL: blobsURL, siteID: 'local', token });

const { default: api } = await import('../netlify/functions/api.mjs');

const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8'
};

createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        if (url.pathname.startsWith('/api/')) {
            const chunks = [];
            for await (const c of req) chunks.push(c);
            const request = new Request(url, {
                method: req.method,
                headers: req.headers,
                body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks)
            });
            const response = await api(request, { ip: req.socket.remoteAddress });
            const headers = {};
            response.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
            const cookies = response.headers.getSetCookie();
            if (cookies.length) headers['set-cookie'] = cookies;
            res.writeHead(response.status, headers);
            res.end(Buffer.from(await response.arrayBuffer()));
            return;
        }
        let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
        if (path.endsWith('/')) path += 'index.html';
        let file = join(root, path);
        if (!file.startsWith(root) || /[/\\]\.|node_modules|[/\\]netlify[/\\]/.test(path)) file = join(root, '404.html');
        let status = 200;
        try { if (!(await stat(file)).isFile()) throw new Error(); } catch { file = join(root, '404.html'); status = 404; }
        res.writeHead(status, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(await readFile(file));
    } catch (e) {
        console.error(e);
        res.writeHead(500); res.end('Server error');
    }
}).listen(port, '127.0.0.1', () => console.log(`DvE wiki running at http://localhost:${port}  (data in ${dataDir})`));
