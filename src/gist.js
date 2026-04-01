import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_GIST_FILE_NAME, GITHUB_TOKEN_ENV_VARS } from './constants.js';
import { makeTempDir, pathExists, sha256Buffer } from './utils.js';

function resolveGitHubToken(env = process.env) {
  for (const key of GITHUB_TOKEN_ENV_VARS) {
    if (env[key]) {
      return env[key];
    }
  }
  return null;
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

export async function upsertPackageToGist({ zipPath, manifest, gistId, fetchImpl, env = process.env }) {
  const token = resolveGitHubToken(env);
  if (!token) {
    throw new Error('Missing GitHub token. Set OPENCLAW_GITHUB_TOKEN, GITHUB_TOKEN, or GH_TOKEN.');
  }

  const zipBuffer = await fs.readFile(zipPath);
  const base64Zip = zipBuffer.toString('base64');
  const description = `OpenClaw migration:${manifest.source.agentId}:${manifest.createdAt}:${manifest.openclawVersion ?? 'unknown'}`;
  const method = gistId ? 'PATCH' : 'POST';
  const url = gistId ? `https://api.github.com/gists/${gistId}` : 'https://api.github.com/gists';
  const response = await githubFetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ...(gistId ? {} : { public: false }),
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

export async function downloadPackageFromGist({ gistId, fetchImpl, env = process.env }) {
  const token = resolveGitHubToken(env);
  if (!token) {
    throw new Error('Missing GitHub token. Set OPENCLAW_GITHUB_TOKEN, GITHUB_TOKEN, or GH_TOKEN.');
  }

  const response = await githubFetch(`https://api.github.com/gists/${gistId}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  }, fetchImpl);
  const gist = await response.json();
  const gistFile = gist?.files?.[DEFAULT_GIST_FILE_NAME];
  if (!gistFile?.content) {
    throw new Error(`Gist ${gistId} does not contain ${DEFAULT_GIST_FILE_NAME}.`);
  }

  const outputDir = await makeTempDir('openclaw-migration-gist-');
  const packagePath = path.join(outputDir, 'migration.zip');
  await fs.writeFile(packagePath, Buffer.from(gistFile.content, 'base64'));
  return {
    packagePath,
    gist,
    cleanup: async () => {
      if (await pathExists(outputDir)) {
        await fs.rm(outputDir, { recursive: true, force: true });
      }
    }
  };
}
