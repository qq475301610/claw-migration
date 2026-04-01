import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_GIST_FILE_NAME, GITHUB_TOKEN_ENV_VARS } from './constants.js';
import { makeTempDir, pathExists, sha256Buffer } from './utils.js';
import { emitProgress } from './progress.js';

const DESCRIPTION_PREFIX = 'OpenClaw migration';
const RAW_DOWNLOAD_TIMEOUT_MS = 120000;
const RAW_PROGRESS_CHUNK_BYTES = 1024 * 1024;

function resolveGitHubToken({ env = process.env, configuredToken } = {}) {
  if (configuredToken) {
    return configuredToken;
  }
  for (const key of GITHUB_TOKEN_ENV_VARS) {
    if (env[key]) {
      return env[key];
    }
  }
  return null;
}

function buildDescription({ manifest, remoteKey }) {
  const parts = [DESCRIPTION_PREFIX];
  if (remoteKey) {
    parts.push(remoteKey);
  }
  parts.push(manifest.source.agentId, manifest.createdAt, manifest.openclawVersion ?? 'unknown');
  return parts.join(':');
}

function matchesRemoteKey(description, remoteKey) {
  if (!remoteKey || typeof description !== 'string') {
    return false;
  }
  return description.startsWith(`${DESCRIPTION_PREFIX}:${remoteKey}:`);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'unknown';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function githubFetch(url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers ?? {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API request failed (${response.status}): ${body}`);
  }

  return response;
}

async function downloadRawTextWithProgress(url, token, fetchImpl = fetch, onProgress) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('GitHub raw gist download timed out.')), RAW_DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub raw gist download failed (${response.status}): ${body}`);
    }

    if (!response.body || typeof response.body.getReader !== 'function') {
      emitProgress(onProgress, 'Downloading archive payload', 'stream unavailable, buffering response');
      return response.text();
    }

    const total = Number.parseInt(response.headers.get('content-length') ?? '', 10);
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    let nextReportAt = RAW_PROGRESS_CHUNK_BYTES;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
      loaded += value.byteLength;
      if (loaded >= nextReportAt) {
        const detail = Number.isFinite(total)
          ? `${formatBytes(loaded)} / ${formatBytes(total)}`
          : `${formatBytes(loaded)} downloaded`;
        emitProgress(onProgress, 'Downloading archive payload', detail);
        nextReportAt += RAW_PROGRESS_CHUNK_BYTES;
      }
    }

    const detail = Number.isFinite(total)
      ? `${formatBytes(loaded)} / ${formatBytes(total)}`
      : `${formatBytes(loaded)} downloaded`;
    emitProgress(onProgress, 'Downloading archive payload', detail);
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
  } finally {
    clearTimeout(timeout);
  }
}

async function loadGistFileContent(gistFile, token, fetchImpl = fetch, onProgress) {
  if (gistFile?.truncated && gistFile?.raw_url) {
    return downloadRawTextWithProgress(gistFile.raw_url, token, fetchImpl, onProgress);
  }

  return gistFile?.content ?? null;
}

export async function findGistByRemoteKey({ remoteKey, fetchImpl, env = process.env, configuredToken } = {}) {
  const token = resolveGitHubToken({ env, configuredToken });
  if (!token) {
    throw new Error('Missing GitHub token. Configure remotes.<name>.settings.token or set OPENCLAW_GITHUB_TOKEN, GITHUB_TOKEN, or GH_TOKEN.');
  }
  if (!remoteKey) {
    return null;
  }

  let page = 1;
  while (page <= 10) {
    const response = await githubFetch(`https://api.github.com/gists?per_page=100&page=${page}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }, fetchImpl);
    const gists = await response.json();
    if (!Array.isArray(gists) || gists.length === 0) {
      return null;
    }

    const match = gists.find((gist) => matchesRemoteKey(gist?.description, remoteKey));
    if (match) {
      return {
        id: match.id,
        url: match.html_url ?? null,
        description: match.description ?? null
      };
    }

    if (gists.length < 100) {
      return null;
    }
    page += 1;
  }

  return null;
}

export async function upsertPackageToGist({ zipPath, manifest, gistId, remoteKey, fetchImpl, env = process.env, configuredToken, onProgress }) {
  emitProgress(onProgress, 'Preparing GitHub upload', remoteKey ?? gistId ?? 'new gist');
  const token = resolveGitHubToken({ env, configuredToken });
  if (!token) {
    throw new Error('Missing GitHub token. Configure remotes.<name>.settings.token or set OPENCLAW_GITHUB_TOKEN, GITHUB_TOKEN, or GH_TOKEN.');
  }

  emitProgress(onProgress, 'Resolving remote target', remoteKey ?? gistId ?? 'new gist');
  const existing = !gistId && remoteKey
    ? await findGistByRemoteKey({ remoteKey, fetchImpl, env, configuredToken: token })
    : null;
  const resolvedGistId = gistId ?? existing?.id ?? null;

  emitProgress(onProgress, 'Reading archive', zipPath);
  const zipBuffer = await fs.readFile(zipPath);
  const base64Zip = zipBuffer.toString('base64');
  const description = buildDescription({ manifest, remoteKey });
  const method = resolvedGistId ? 'PATCH' : 'POST';
  const url = resolvedGistId ? `https://api.github.com/gists/${resolvedGistId}` : 'https://api.github.com/gists';
  emitProgress(onProgress, 'Sending GitHub request', method + ' ' + (resolvedGistId ?? 'new'));
  const response = await githubFetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ...(resolvedGistId ? {} : { public: false }),
      description,
      files: {
        [DEFAULT_GIST_FILE_NAME]: { content: base64Zip },
        'manifest.json': { content: JSON.stringify(manifest, null, 2) }
      }
    })
  }, fetchImpl);

  const payload = await response.json();
  emitProgress(onProgress, 'GitHub upload finished', payload.id ?? payload.html_url ?? 'ok');
  return {
    kind: 'gist',
    id: payload.id,
    url: payload.html_url,
    sha256: sha256Buffer(zipBuffer)
  };
}

export async function uploadPackageToGist(args) {
  return upsertPackageToGist(args);
}

export async function downloadPackageFromGist({ gistId, remoteKey, fetchImpl, env = process.env, configuredToken, onProgress }) {
  emitProgress(onProgress, 'Resolving remote package', remoteKey ?? gistId ?? 'gist');
  const token = resolveGitHubToken({ env, configuredToken });
  if (!token) {
    throw new Error('Missing GitHub token. Configure remotes.<name>.settings.token or set OPENCLAW_GITHUB_TOKEN, GITHUB_TOKEN, or GH_TOKEN.');
  }

  const resolvedGistId = gistId ?? (await findGistByRemoteKey({ remoteKey, fetchImpl, env, configuredToken: token }))?.id;
  if (!resolvedGistId) {
    throw new Error(`Unable to resolve a GitHub gist for remote '${remoteKey ?? 'unknown'}'.`);
  }

  emitProgress(onProgress, 'Downloading Gist metadata', resolvedGistId);
  const response = await githubFetch(`https://api.github.com/gists/${resolvedGistId}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  }, fetchImpl);
  const gist = await response.json();
  const gistFile = gist?.files?.[DEFAULT_GIST_FILE_NAME];
  emitProgress(onProgress, 'Downloading archive payload', gistFile?.truncated ? 'raw_url' : 'content');
  const base64Content = await loadGistFileContent(gistFile, token, fetchImpl, onProgress);
  if (!base64Content) {
    throw new Error(`Gist ${resolvedGistId} does not contain ${DEFAULT_GIST_FILE_NAME}.`);
  }

  emitProgress(onProgress, 'Decoding base64 payload', resolvedGistId);
  const outputDir = await makeTempDir('openclaw-migration-gist-');
  const packagePath = path.join(outputDir, 'migration.zip');
  await fs.writeFile(packagePath, Buffer.from(base64Content, 'base64'));
  emitProgress(onProgress, 'Archive downloaded', packagePath);
  return {
    packagePath,
    gist,
    gistId: resolvedGistId,
    cleanup: async () => {
      if (await pathExists(outputDir)) {
        await fs.rm(outputDir, { recursive: true, force: true });
      }
    }
  };
}
