import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_GIST_FILE_NAME, GITHUB_TOKEN_ENV_VARS } from './constants.js';
import { makeTempDir, pathExists, sha256Buffer } from './utils.js';

const DESCRIPTION_PREFIX = 'OpenClaw migration';

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

async function loadGistFileContent(gistFile, token, fetchImpl = fetch) {
  if (gistFile?.truncated && gistFile?.raw_url) {
    const response = await fetchImpl(gistFile.raw_url, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub raw gist download failed (${response.status}): ${body}`);
    }
    return response.text();
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

export async function upsertPackageToGist({ zipPath, manifest, gistId, remoteKey, fetchImpl, env = process.env, configuredToken }) {
  const token = resolveGitHubToken({ env, configuredToken });
  if (!token) {
    throw new Error('Missing GitHub token. Configure remotes.<name>.settings.token or set OPENCLAW_GITHUB_TOKEN, GITHUB_TOKEN, or GH_TOKEN.');
  }

  const existing = !gistId && remoteKey
    ? await findGistByRemoteKey({ remoteKey, fetchImpl, env, configuredToken: token })
    : null;
  const resolvedGistId = gistId ?? existing?.id ?? null;

  const zipBuffer = await fs.readFile(zipPath);
  const base64Zip = zipBuffer.toString('base64');
  const description = buildDescription({ manifest, remoteKey });
  const method = resolvedGistId ? 'PATCH' : 'POST';
  const url = resolvedGistId ? `https://api.github.com/gists/${resolvedGistId}` : 'https://api.github.com/gists';
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

export async function downloadPackageFromGist({ gistId, remoteKey, fetchImpl, env = process.env, configuredToken }) {
  const token = resolveGitHubToken({ env, configuredToken });
  if (!token) {
    throw new Error('Missing GitHub token. Configure remotes.<name>.settings.token or set OPENCLAW_GITHUB_TOKEN, GITHUB_TOKEN, or GH_TOKEN.');
  }

  const resolvedGistId = gistId ?? (await findGistByRemoteKey({ remoteKey, fetchImpl, env, configuredToken: token }))?.id;
  if (!resolvedGistId) {
    throw new Error(`Unable to resolve a GitHub gist for remote '${remoteKey ?? 'unknown'}'.`);
  }

  const response = await githubFetch(`https://api.github.com/gists/${resolvedGistId}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  }, fetchImpl);
  const gist = await response.json();
  const gistFile = gist?.files?.[DEFAULT_GIST_FILE_NAME];
  const base64Content = await loadGistFileContent(gistFile, token, fetchImpl);
  if (!base64Content) {
    throw new Error(`Gist ${resolvedGistId} does not contain ${DEFAULT_GIST_FILE_NAME}.`);
  }

  const outputDir = await makeTempDir('openclaw-migration-gist-');
  const packagePath = path.join(outputDir, 'migration.zip');
  await fs.writeFile(packagePath, Buffer.from(base64Content, 'base64'));
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

