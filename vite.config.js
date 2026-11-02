import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const FORWARD_PREFIX = '/forward';
const BASE_URL_HEADER = 'x-api-base-url';
const FORWARDED_HEADERS = ['authorization', 'content-type', 'accept'];

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : undefined));
    req.on('error', reject);
  });
}

// The page picks the API server at runtime (base URL field). Browsers would block direct calls to the
// lumberfi APIs from localhost (CORS), so the dev server forwards /forward/<path> to <base URL>/<path>.
function apiForwarder() {
  return {
    name: 'api-forwarder',
    configureServer(server) {
      server.middlewares.use(FORWARD_PREFIX, async (req, res) => {
        const baseUrl = (req.headers[BASE_URL_HEADER] || '').toString().replace(/\/+$/, '');
        if (!/^https?:\/\/[^/]+/.test(baseUrl)) {
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ message: `Invalid base URL: "${baseUrl}"` }));
          return;
        }

        const headers = {};
        for (const name of FORWARDED_HEADERS) {
          if (req.headers[name]) headers[name] = req.headers[name];
        }

        try {
          const upstream = await fetch(baseUrl + req.url, {
            method: req.method,
            headers,
            body: ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req),
          });
          res.statusCode = upstream.status;
          const contentType = upstream.headers.get('content-type');
          if (contentType) res.setHeader('content-type', contentType);
          res.end(Buffer.from(await upstream.arrayBuffer()));
        }
        catch (e) {
          res.statusCode = 502;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ message: `Could not reach ${baseUrl}: ${e.cause?.code || e.message}` }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiForwarder()],
  server: { port: 5173 },
});
