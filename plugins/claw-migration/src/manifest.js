import fs from 'node:fs/promises';
import path from 'node:path';
import { MIGRATION_SCHEMA } from './constants.js';
import { collectFiles, relativeFrom, sha256File, uniq, writeJson } from './utils.js';

export async function buildChecksums(stagingDir) {
  const files = await collectFiles(stagingDir);
  const checksums = {};
  for (const filePath of files) {
    const relativePath = relativeFrom(stagingDir, filePath);
    if (relativePath === 'manifest.json') {
      continue;
    }
    checksums[relativePath] = await sha256File(filePath);
  }
  return checksums;
}

export async function createManifest({ stagingDir, config, agentId, workspacePath, includeTranscripts, notes, warnings }) {
  const bindings = (config.bindings ?? []).filter((binding) => binding?.agentId === agentId);
  const channels = uniq(bindings.map((binding) => binding?.match?.channel));
  const plugins = Object.entries(config?.plugins?.entries ?? {})
    .filter(([, value]) => value?.enabled !== false)
    .map(([name]) => name);
  const skills = Object.entries(config?.skills?.entries ?? {})
    .filter(([, value]) => value?.enabled !== false)
    .map(([name]) => name);

  const manifest = {
    schema: MIGRATION_SCHEMA,
    createdAt: new Date().toISOString(),
    openclawVersion: config?.meta?.lastTouchedVersion ?? null,
    source: {
      host: process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? 'unknown-host',
      agentId,
      workspace: workspacePath
    },
    contents: {
      config: true,
      sessions: true,
      transcripts: includeTranscripts,
      workspace: true
    },
    requires: {
      channels,
      plugins,
      skills
    },
    warnings: warnings ?? [],
    notes: notes ?? `Agent '${agentId}' migration package`
  };

  await writeJson(path.join(stagingDir, 'manifest.json'), manifest);
  manifest.checksums = await buildChecksums(stagingDir);
  await writeJson(path.join(stagingDir, 'manifest.json'), manifest);
  return manifest;
}

export async function loadManifest(extractedDir) {
  const manifestPath = path.join(extractedDir, 'manifest.json');
  const raw = await fs.readFile(manifestPath, 'utf8');
  return JSON.parse(raw);
}
