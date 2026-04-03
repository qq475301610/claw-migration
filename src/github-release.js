import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_RELEASE_ASSET_NAME } from './constants.js';
import { makeTempDir, pathExists, sha256Buffer } from './utils.js';
import { emitProgress } from './progress.js';

const DESCRIPTION_PREFIX = 'OpenClaw migration';
const DOWNLOAD_TIMEOUT_MS = 120000;
const PROGRESS_CHUNK_BYTES = 1024 * 1024;

function requireGitHubToken(configuredToken) {
  if (!configuredToken) {
    throw new Error('Missing GitHub token. Configure remotes.<name>.settings.token.');
  }
  return configuredToken;
}

function sanitizeTagPart(value) {
  return String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'default';
}

export function buildReleaseTag(remoteKey) {
  return `claw-migration-${sanitizeTagPart(remoteKey)}`;
}

function buildReleaseName({ remoteKey }) {
  return `Claw Migration: ${remoteKey}`;
}

function buildReleaseBody({ manifest, remoteKey }) {
  return [
    `${DESCRIPTION_PREFIX}`,
    `remoteKey: ${remoteKey}`,
    `agentId: ${manifest.source.agentId}`,
    `createdAt: ${manifest.createdAt}`,
    `openclawVersion: ${manifest.openclawVersion ?? 'unknown'}`
  ].join('\n');
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

async function githubAssetFetch(url, token, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/octet-stream',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    },
    redirect: 'manual'
  });

  if (response.status === 302 || response.status === 301) {
    const redirectUrl = response.headers.get('location');
    if (!redirectUrl) {
      throw new Error('GitHub asset download redirected without a location header.');
    }
    return fetchImpl(redirectUrl, { redirect: 'follow' });
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub asset download failed (${response.status}): ${body}`);
  }

  return response;
}

async function downloadStreamToFile(response, packagePath, onProgress) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('GitHub release asset download timed out.')), DOWNLOAD_TIMEOUT_MS);
  try {
    if (!response.body || typeof response.body.getReader !== 'function') {
      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(packagePath, buffer);
      emitProgress(onProgress, 'Downloading archive payload', formatBytes(buffer.byteLength));
      return;
    }

    const total = Number.parseInt(response.headers.get('content-length') ?? '', 10);
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    let nextReportAt = PROGRESS_CHUNK_BYTES;

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
        nextReportAt += PROGRESS_CHUNK_BYTES;
      }
    }

    const detail = Number.isFinite(total)
      ? `${formatBytes(loaded)} / ${formatBytes(total)}`
      : `${formatBytes(loaded)} downloaded`;
    emitProgress(onProgress, 'Downloading archive payload', detail);
    await fs.writeFile(packagePath, Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

async function getReleaseByTag({ owner, repo, tag, token, fetchImpl }) {
  try {
    const response = await githubFetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }, fetchImpl);
    return response.json();
  } catch (error) {
    if (String(error.message).includes('GitHub API request failed (404)')) {
      return null;
    }
    throw error;
  }
}

async function createRelease({ owner, repo, tag, remoteKey, manifest, token, fetchImpl }) {
  const response = await githubFetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      tag_name: tag,
      name: buildReleaseName({ remoteKey }),
      body: buildReleaseBody({ manifest, remoteKey }),
      draft: false,
      prerelease: false,
      generate_release_notes: false
    })
  }, fetchImpl);
  return response.json();
}

async function ensureRelease({ owner, repo, remoteKey, manifest, releaseId, token, fetchImpl, onProgress }) {
  const tag = buildReleaseTag(remoteKey);
  if (releaseId) {
    try {
      const response = await githubFetch(`https://api.github.com/repos/${owner}/${repo}/releases/${releaseId}`, {
        headers: { Authorization: `Bearer ${token}` }
      }, fetchImpl);
      const release = await response.json();
      return { release, tag };
    } catch (error) {
      if (!String(error.message).includes('GitHub API request failed (404)')) {
        throw error;
      }
    }
  }

  emitProgress(onProgress, 'Resolving remote release', tag);
  let release = await getReleaseByTag({ owner, repo, tag, token, fetchImpl });
  if (!release) {
    emitProgress(onProgress, 'Creating GitHub release', tag);
    release = await createRelease({ owner, repo, tag, remoteKey, manifest, token, fetchImpl });
  }

  return { release, tag };
}

function parseUploadUrl(uploadUrl) {
  return uploadUrl.replace(/\{\?name,label\}$/, '');
}

async function deleteExistingAsset({ owner, repo, assetId, token, fetchImpl, onProgress }) {
  emitProgress(onProgress, 'Removing previous release asset', String(assetId));
  await githubFetch(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${assetId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`
    }
  }, fetchImpl);
}

async function uploadReleaseAsset({ uploadUrl, assetName, zipBuffer, token, fetchImpl = fetch, onProgress }) {
  emitProgress(onProgress, 'Uploading release asset', assetName);
  const response = await fetchImpl(`${uploadUrl}?name=${encodeURIComponent(assetName)}`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/zip',
      'Content-Length': String(zipBuffer.byteLength),
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: zipBuffer
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub asset upload failed (${response.status}): ${body}`);
  }

  return response.json();
}

export async function upsertPackageToRelease({ zipPath, manifest, owner, repo, releaseId, remoteKey, fetchImpl, configuredToken, onProgress }) {
  emitProgress(onProgress, 'Preparing GitHub upload', remoteKey ?? 'release');
  const token = requireGitHubToken(configuredToken);
  if (!owner || !repo) {
    throw new Error('GitHub release provider requires remotes.<name>.settings.owner and remotes.<name>.settings.repo.');
  }
  if (!remoteKey) {
    throw new Error('GitHub release provider requires remotes.<name>.settings.remoteKey or an agent id fallback.');
  }

  const zipBuffer = await fs.readFile(zipPath);
  const { release, tag } = await ensureRelease({ owner, repo, remoteKey, manifest, releaseId, token, fetchImpl, onProgress });
  const assetName = DEFAULT_RELEASE_ASSET_NAME;
  const existingAsset = (release.assets ?? []).find((asset) => asset.name === assetName);
  if (existingAsset) {
    await deleteExistingAsset({ owner, repo, assetId: existingAsset.id, token, fetchImpl, onProgress });
  }

  const uploadedAsset = await uploadReleaseAsset({
    uploadUrl: parseUploadUrl(release.upload_url),
    assetName,
    zipBuffer,
    token,
    fetchImpl,
    onProgress
  });

  emitProgress(onProgress, 'GitHub upload finished', uploadedAsset.browser_download_url ?? tag);
  return {
    kind: 'github-release',
    id: release.id,
    releaseId: release.id,
    tag,
    assetId: uploadedAsset.id,
    url: uploadedAsset.browser_download_url ?? release.html_url ?? null,
    sha256: sha256Buffer(zipBuffer)
  };
}

export async function downloadPackageFromRelease({ owner, repo, releaseId, remoteKey, fetchImpl, configuredToken, onProgress }) {
  emitProgress(onProgress, 'Resolving remote package', remoteKey ?? String(releaseId ?? 'release'));
  const token = requireGitHubToken(configuredToken);
  if (!owner || !repo) {
    throw new Error('GitHub release provider requires remotes.<name>.settings.owner and remotes.<name>.settings.repo.');
  }
  if (!remoteKey && !releaseId) {
    throw new Error('GitHub release pull requires remotes.<name>.settings.remoteKey or remotes.<name>.settings.releaseId.');
  }

  const tag = remoteKey ? buildReleaseTag(remoteKey) : null;
  const release = releaseId
    ? await githubFetch(`https://api.github.com/repos/${owner}/${repo}/releases/${releaseId}`, { headers: { Authorization: `Bearer ${token}` } }, fetchImpl).then((response) => response.json())
    : await getReleaseByTag({ owner, repo, tag, token, fetchImpl });

  if (!release) {
    throw new Error(`Unable to resolve a GitHub release for remote '${remoteKey ?? releaseId}'.`);
  }

  const asset = (release.assets ?? []).find((item) => item.name === DEFAULT_RELEASE_ASSET_NAME) ?? release.assets?.[0];
  if (!asset) {
    throw new Error(`Release ${release.id} does not contain a migration asset.`);
  }

  emitProgress(onProgress, 'Downloading release metadata', `${owner}/${repo}@${release.tag_name}`);
  const outputDir = await makeTempDir('openclaw-migration-release-');
  const packagePath = path.join(outputDir, DEFAULT_RELEASE_ASSET_NAME);
  const response = await githubAssetFetch(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${asset.id}`, token, fetchImpl);
  await downloadStreamToFile(response, packagePath, onProgress);
  emitProgress(onProgress, 'Archive downloaded', packagePath);
  return {
    packagePath,
    release,
    releaseId: release.id,
    assetId: asset.id,
    cleanup: async () => {
      if (await pathExists(outputDir)) {
        await fs.rm(outputDir, { recursive: true, force: true });
      }
    }
  };
}
