import { execFile } from './utils.js';

export async function restartGateway({ runner = execFile } = {}) {
  return runner('openclaw', ['gateway', 'restart']);
}
