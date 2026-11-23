// Lightweight HTTP Server for PrintDrop Admin & Partner Sales Portals
// Accessible locally, on LAN, and over Tailscale VPN (100.x.y.z)
// Usage: npm run admin:serve
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const adminFile = path.join(rootDir, 'admin-portal', 'index.html');
const partnerFile = path.join(rootDir, 'partner-portal', 'index.html');
const PORT = parseInt(process.env.ADMIN_PORT || '8787', 10);

function serveHtml(filePath, label, res) {
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Failed to load ${label}`);
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache'
    });
    res.end(html);
  });
}

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/' || urlPath === '/index.html' || urlPath === '/admin' || urlPath === '/admin/' || urlPath === '/admin/index.html') {
    serveHtml(adminFile, 'admin-portal/index.html', res);
  } else if (urlPath === '/partner' || urlPath === '/partner/' || urlPath === '/partner/index.html' || urlPath === '/sales' || urlPath === '/sales/') {
    serveHtml(partnerFile, 'partner-portal/index.html', res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found — Use /admin for Admin Portal or /partner for Partner Sales Portal');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n====================================================================');
  console.log('   PrintDrop Admin & Partner Sales Portal Server Running');
  console.log('====================================================================');
  console.log(`   Local Admin     : http://localhost:${PORT}/admin`);
  console.log(`   Local Partner   : http://localhost:${PORT}/partner`);
  const nets = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(nets)) {
    for (const addr of addrs || []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        const isTs = addr.address.startsWith('100.');
        const label = isTs ? 'Tailscale VPN' : `LAN (${name})`;
        console.log('   ----------------------------------------------------------------');
        console.log(`   ${(label + ' Admin').padEnd(22)}: http://${addr.address}:${PORT}/admin`);
        console.log(`   ${(label + ' Partner').padEnd(22)}: http://${addr.address}:${PORT}/partner`);
      }
    }
  }
  console.log('====================================================================\n');
});
