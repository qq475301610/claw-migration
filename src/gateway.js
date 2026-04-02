import net from 'node:net';
import os from 'node:os';
import { execFile } from './utils.js';

const DEFAULT_GATEWAY_HOST = '127.0.0.1';
const DEFAULT_GATEWAY_PORT = 18789;
const DEFAULT_GATEWAY_PROBE_TIMEOUT_MS = 500;

export async function isGatewayRunning({
  host = DEFAULT_GATEWAY_HOST,
  port = DEFAULT_GATEWAY_PORT,
  timeoutMs = DEFAULT_GATEWAY_PROBE_TIMEOUT_MS
} = {}) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;

    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

export async function restartGateway({ runner = execFile } = {}) {
  if (os.platform() === 'win32') {
    return runner('powershell.exe', ['-NoProfile', '-Command', 'openclaw gateway restart'], { windowsHide: true });
  }

  return runner('openclaw', ['gateway', 'restart'], { windowsHide: true });
}
