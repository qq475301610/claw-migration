import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CORE_WORKSPACE_FILES,
  EXCLUDED_FILE_NAMES,
  EXCLUDED_PATH_SEGMENTS,
  EXCLUDED_PATTERNS,
  EXCLUDED_SUFFIXES,
  PACKAGE_ROOT_FILES
} from './constants.js';
import { createManifest } from './manifest.js';
import { loadOpenClawState } from './openclaw-state.js';
import {
  collectFiles,
  copyDirectory,
  copyFile,
  ensureDir,
  makeTempDir,
  pathExists,
  readJson,
  relativeFrom,
  sha256File,
  toPosixPath,
  uniq,
  writeJson
} from './utils.js';
import { unzipToDirectory } from './archive.js';

function shouldExclude(relativePath, fileName) {
  const normalized = toPosixPath(relativePath);
  if (EXCLUDED_FILE_NAMES.includes(fileName)) {
    return true;
  }
  if (EXCLUDED_SUFFIXES.some((suffix) => fileName.endsWith(suffix))) {
    return true;
  }
  if (EXCLUDED_PATTERNS.some((pattern) => fileName.includes(pattern))) {
    return true;
  }
  return EXCLUDED_PATH_SEGMENTS.some((segment) => normalized.split('/').includes(segment));
}

async function copyRequiredWorkspace(workspacePath, stagingDir, warnings) {
  const workspaceTarget = path.join(stagingDir, 'workspace');
  await ensureDir(workspaceTarget);

  for (const fileName of CORE_WORKSPACE_FILES) {
    const sourcePath = path.join(workspacePath, fileName);
    if (await pathExists(sourcePath)) {
      await copyFile(sourcePath, path.join(workspaceTarget, fileName));
      continue;
    }
    if (fileName === '.env') {
      warnings.push(`Optional workspace file missing: ${fileName}`);
      continue;
    }
    throw new Error(`Missing required workspace file: ${sourcePath}`);
  }

  const memoryDir = path.join(workspacePath, 'memory');
  if (!(await pathExists(memoryDir))) {
    throw new Error(`Missing required workspace memory directory: ${memoryDir}`);
  }
  await copyDirectory(memoryDir, path.join(workspaceTarget, 'memory'));

  const assetsDir = path.join(workspacePath, 'assets');
  if (await pathExists(assetsDir)) {
    await copyDirectory(assetsDir, path.join(workspaceTarget, 'assets'));
  } else {
    warnings.push('Optional workspace assets directory missing.');
  }
}

async function findPackageRoot(extractedDir) {
  const directManifest = path.join(extractedDir, 'manifest.json');
  if (await pathExists(directManifest)) {
    return extractedDir;
  }

  const entries = await fs.readdir(extractedDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = path.join(extractedDir, entry.name);
    if (await pathExists(path.join(candidate, 'manifest.json'))) {
      return candidate;
    }
  }

  return extractedDir;
}

export async function stageMigrationPackage({ openClawDir, agentId, includeTranscripts = false, notes }) {
  const state = await loadOpenClawState({ openClawDir, agentId });
  const warnings = [];
  const stagingDir = await makeTempDir(`openclaw-migration-${agentId}-`);

  await writeJson(path.join(stagingDir, 'openclaw.json'), state.config);

  const agentConfigDir = path.join(stagingDir, 'agents', agentId, 'agent');
  await ensureDir(agentConfigDir);
  const sourceAuthProfiles = path.join(state.agentDir, 'agent', 'auth-profiles.json');
  const sourceModels = path.join(state.agentDir, 'agent', 'models.json');

  if (!(await pathExists(sourceAuthProfiles))) {
    throw new Error(`Missing required auth-profiles.json: ${sourceAuthProfiles}`);
  }
  if (!(await pathExists(sourceModels))) {
    throw new Error(`Missing required models.json: ${sourceModels}`);
  }

  await copyFile(sourceAuthProfiles, path.join(agentConfigDir, 'auth-profiles.json'));
  await copyFile(sourceModels, path.join(agentConfigDir, 'models.json'));

  const sourceSessionsDir = path.join(state.agentDir, 'sessions');
  const sourceSessionsJson = path.join(sourceSessionsDir, 'sessions.json');
  if (!(await pathExists(sourceSessionsJson))) {
    throw new Error(`Missing required sessions.json: ${sourceSessionsJson}`);
  }

  const targetSessionsDir = path.join(stagingDir, 'agents', agentId, 'sessions');
  await ensureDir(targetSessionsDir);
  await copyFile(sourceSessionsJson, path.join(targetSessionsDir, 'sessions.json'));

  if (includeTranscripts) {
    const sessionEntries = await fs.readdir(sourceSessionsDir, { withFileTypes: true });
    for (const entry of sessionEntries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
        continue;
      }
      if (shouldExclude(entry.name, entry.name)) {
        continue;
      }
      await copyFile(path.join(sourceSessionsDir, entry.name), path.join(targetSessionsDir, entry.name));
    }
  }

  await copyRequiredWorkspace(state.workspacePath, stagingDir, warnings);
  const manifest = await createManifest({
    stagingDir,
    config: state.config,
    agentId,
    workspacePath: state.workspacePath,
    includeTranscripts,
    notes,
    warnings
  });

  return { stagingDir, manifest, state };
}

export async function validateExtractedPackage({ extractedDir, agentId }) {
  const packageRoot = await findPackageRoot(extractedDir);
  const manifest = await readJson(path.join(packageRoot, 'manifest.json'));
  const effectiveAgentId = agentId ?? manifest?.source?.agentId;
  const requiredFiles = [
    ...PACKAGE_ROOT_FILES,
    toPosixPath(path.join('agents', effectiveAgentId, 'agent', 'auth-profiles.json')),
    toPosixPath(path.join('agents', effectiveAgentId, 'agent', 'models.json')),
    toPosixPath(path.join('agents', effectiveAgentId, 'sessions', 'sessions.json'))
  ];

  const blockers = [];
  for (const relativePath of requiredFiles) {
    const fullPath = path.join(packageRoot, relativePath);
    if (!(await pathExists(fullPath))) {
      blockers.push(`Missing required package file: ${relativePath}`);
    }
  }

  const checksums = manifest?.checksums ?? {};
  for (const [relativePath, expected] of Object.entries(checksums)) {
    const fullPath = path.join(packageRoot, relativePath);
    if (!(await pathExists(fullPath))) {
      blockers.push(`Checksum entry missing file: ${relativePath}`);
      continue;
    }
    const actual = await sha256File(fullPath);
    if (actual !== expected) {
      blockers.push(`Checksum mismatch: ${relativePath}`);
    }
  }

  return {
    manifest,
    agentId: effectiveAgentId,
    blockers,
    warnings: manifest?.warnings ?? [],
    packageRoot
  };
}

export async function extractPackageForInspection({ packagePath, agentId }) {
  const extractedDir = await makeTempDir('openclaw-migration-extract-');
  await unzipToDirectory(packagePath, extractedDir);
  const validation = await validateExtractedPackage({ extractedDir, agentId });
  return { extractedDir, ...validation };
}

export async function summarizePackageContents(packageRoot) {
  const files = await collectFiles(packageRoot);
  return uniq(files.map((filePath) => relativeFrom(packageRoot, filePath)));
}
