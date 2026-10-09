#!/usr/bin/env node
// Open an explicitly selected relay. Sign in through its dashboard; credentials
// never pass through this helper, a browser command argument or its output.
//   RELAY_URL=http://127.0.0.1:8787 npm run open
import { execFileSync } from 'node:child_process';

function relayOrigin(value) {
  try {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    return url.origin;
  } catch {
    throw new Error('Set RELAY_URL to an HTTPS origin, or an HTTP loopback origin, with no credentials, path, query or fragment.');
  }
}

try {
  if (process.argv.length > 2) throw new Error('Use RELAY_URL=<relay origin> npm run open. No command-line options are supported.');
  const origin = relayOrigin(process.env.RELAY_URL);
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : null;
  if (!opener) throw new Error('The open helper supports macOS and Linux. Open RELAY_URL in your browser and sign in there.');
  execFileSync(opener, [origin], { stdio: 'ignore' });
  console.log('Opened the relay dashboard. Sign in there.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
