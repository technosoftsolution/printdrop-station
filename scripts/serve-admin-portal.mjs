// Lightweight HTTP Server for PrintDrop Admin Portal (accessible locally & over Tailscale VPN)
// Usage: npm run admin:serve
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const adminFile = path.join(rootDir, 'admin-portal', 'index.html');
const PORT = parseInt(process.env.ADMIN_PORT || '8787', 10);

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/' || urlPath === '/index.html' || urlPath === '/admin' || urlPath === '/admin/') {
    fs.readFile(adminFile, 'utf8', (err, html) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Failed to load admin-portal/index.html');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(html);
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n========================================================');
  console.log('   PrintDrop Admin Portal Server Running');
  console.log('========================================================');
  console.log(`   Local Access    : http://localhost:${PORT}`);
  const nets = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(nets)) {
    for (const addr of addrs || []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        const tag = addr.address.startsWith('100.') ? 'Tailscale VPN   ' : `LAN (${name})`.padEnd(16);
        console.log(`   ${tag}: http://${addr.address}:${PORT}`);
      }
    }
  }
  console.log('========================================================\n');
});
