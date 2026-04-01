import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile, pathExists } from './utils.js';

export async function rebuildMemoryIndex({ agentId }) {
  try {
    await execFile('openclaw', ['memory', 'index', '--agent', agentId, '--force']);
    return { ok: true };
  } catch (error) {
    return { ok: false, warning: `Memory index rebuild failed: ${error.message}` };
  }
}

export async function backupPath(sourcePath, suffix) {
  if (!(await pathExists(sourcePath))) {
    return null;
  }

  const backupPath = `${sourcePath}.${suffix}`;
  await fs.cp(sourcePath, backupPath, { recursive: true, force: true });
  return backupPath;
}

export async function restoreBackup(sourceBackup, targetPath) {
  if (!sourceBackup) {
    return;
  }
  await fs.rm(targetPath, { recursive: true, force: true });
  await fs.cp(sourceBackup, targetPath, { recursive: true, force: true });
}

export async function copyTree(sourceDir, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  await fs.cp(sourceDir, targetDir, { recursive: true, force: true });
}

export async function writeTextFile(targetPath, content) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, 'utf8');
}
