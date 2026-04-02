import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const OPENCLAW_MIGRATION_TEMP_PREFIXES = [
  'openclaw-migration-',
  'openclaw-migration-output-',
  'openclaw-migration-gist-',
  'openclaw-migration-extract-'
];

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
  return dirPath;
}

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(jsonPath) {
  const raw = await fs.readFile(jsonPath, 'utf8');
  return JSON.parse(raw);
}

export async function writeJson(jsonPath, value) {
  await ensureDir(path.dirname(jsonPath));
  await fs.writeFile(jsonPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function sha256File(filePath) {
  const buffer = await fs.readFile(filePath);
  return `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
}

export function sha256Buffer(buffer) {
  return `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
}

export async function collectFiles(rootDir) {
  const files = [];

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return files.sort();
}

function normalizeSpawnCommand(command, args) {
  const isWindows = os.platform() === 'win32';
  if (!isWindows) {
    return { command, args };
  }

  const lower = command.toLowerCase();
  if (lower.endsWith('.cmd') || lower.endsWith('.bat')) {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/c', command, ...args]
    };
  }

  return { command, args };
}

export async function execFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const normalized = normalizeSpawnCommand(command, args);
    const child = spawn(normalized.command, normalized.args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: options.windowsHide ?? false
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`Command failed (${code}): ${normalized.command} ${normalized.args.join(' ')}`);
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

export async function makeTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function cleanupStaleMigrationTempDirs(options = {}) {
  const tempRoot = options.tempRoot ?? os.tmpdir();
  const prefixes = options.prefixes ?? OPENCLAW_MIGRATION_TEMP_PREFIXES;
  const entries = await fs.readdir(tempRoot, { withFileTypes: true });
  const removed = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (!prefixes.some((prefix) => entry.name.startsWith(prefix))) {
      continue;
    }

    const fullPath = path.join(tempRoot, entry.name);
    await fs.rm(fullPath, { recursive: true, force: true });
    removed.push(fullPath);
  }

  return removed;
}

export function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

export function mergeObjects(targetValue, sourceValue) {
  if (!isPlainObject(targetValue)) {
    return deepClone(sourceValue);
  }
  if (!isPlainObject(sourceValue)) {
    return sourceValue === undefined ? deepClone(targetValue) : deepClone(sourceValue);
  }

  const result = deepClone(targetValue);
  for (const [key, value] of Object.entries(sourceValue)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = mergeObjects(result[key], value);
      continue;
    }
    result[key] = deepClone(value);
  }
  return result;
}

export async function copyFile(sourcePath, targetPath) {
  await ensureDir(path.dirname(targetPath));
  await fs.copyFile(sourcePath, targetPath);
}

export async function copyDirectory(sourceDir, targetDir, filter) {
  await ensureDir(targetDir);
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    const allowed = filter ? await filter(sourcePath, entry) : true;
    if (!allowed) {
      continue;
    }
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath, filter);
    } else {
      await copyFile(sourcePath, targetPath);
    }
  }
}

export async function replaceDirectory(sourceDir, targetDir, filter) {
  await fs.rm(targetDir, { recursive: true, force: true });
  await copyDirectory(sourceDir, targetDir, filter);
}

export async function removeIfExists(targetPath) {
  if (await pathExists(targetPath)) {
    await fs.rm(targetPath, { recursive: true, force: true });
  }
}

export function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

export async function promptYesNo(message) {
  process.stdout.write(`${message} [y/N] `);
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
    break;
  }
  const answer = Buffer.concat(chunks).toString('utf8').trim().toLowerCase();
  return answer === 'y' || answer === 'yes';
}

export function relativeFrom(rootDir, fullPath) {
  return toPosixPath(path.relative(rootDir, fullPath));
}

