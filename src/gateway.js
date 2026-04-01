import os from 'node:os';
import { execFile } from './utils.js';

export async function restartGateway({ runner = execFile } = {}) {
  if (os.platform() === 'win32') {
    return runner('powershell.exe', ['-NoProfile', '-Command', 'openclaw gateway restart']);
  }

  return runner('openclaw', ['gateway', 'restart']);
}
