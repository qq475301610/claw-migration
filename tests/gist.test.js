import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReleaseTag, downloadPackageFromRelease, upsertPackageToRelease } from '../src/github-release.js';

async function withTempFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'release-test-'));
  const filePath = path.join(dir, 'migration.zip');
  await fs.writeFile(filePath, Buffer.from('zip-content'));
  return { dir, filePath };
}

function releasePayload(overrides = {}) {
  return {
    id: 123,
    tag_name: 'claw-migration-main-agent',
    html_url: 'https://github.com/octo-org/migration-store/releases/tag/claw-migration-main-agent',
    upload_url: 'https://uploads.github.com/repos/octo-org/migration-store/releases/123/assets{?name,label}',
    assets: [
      {
        id: 456,
        name: 'migration.zip',
        browser_download_url: 'https://github.com/octo-org/migration-store/releases/download/claw-migration-main-agent/migration.zip'
      }
    ],
    ...overrides
  };
}

test('github release transport uploads and downloads zip payloads', async () => {
  const { dir, filePath } = await withTempFile();
  const requests = [];

  const uploadFetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.includes('/releases/tags/')) {
      return { ok: false, status: 404, text: async () => 'not found' };
    }
    if (url.endsWith('/releases')) {
      return { ok: true, json: async () => releasePayload({ assets: [] }) };
    }
    if (url.startsWith('https://uploads.github.com/')) {
      return {
        ok: true,
        json: async () => ({
          id: 456,
          name: 'migration.zip',
          browser_download_url: 'https://github.com/octo-org/migration-store/releases/download/claw-migration-main-agent/migration.zip'
        })
      };
    }
    throw new Error(`Unexpected upload url: ${url}`);
  };

  const uploadResult = await upsertPackageToRelease({
    zipPath: filePath,
    manifest: {
      source: { agentId: 'main' },
      createdAt: '2026-03-31T10:00:00.000Z',
      openclawVersion: '2026.3.28'
    },
    owner: 'octo-org',
    repo: 'migration-store',
    remoteKey: 'main-agent',
    fetchImpl: uploadFetch,
    configuredToken: 'token'
  });

  assert.equal(uploadResult.releaseId, 123);
  assert.equal(uploadResult.assetId, 456);
  assert.equal(uploadResult.tag, 'claw-migration-main-agent');
  assert.equal(requests[0].url.includes('/releases/tags/claw-migration-main-agent'), true);

  const downloadFetch = async (url) => {
    if (url.endsWith('/releases/123')) {
      return { ok: true, json: async () => releasePayload() };
    }
    if (url.endsWith('/releases/assets/456')) {
      return new Response(Buffer.from('zip-content'), {
        status: 200,
        headers: { 'content-length': String(Buffer.byteLength('zip-content')) }
      });
    }
    throw new Error(`Unexpected download url: ${url}`);
  };

  const downloadResult = await downloadPackageFromRelease({
    owner: 'octo-org',
    repo: 'migration-store',
    releaseId: 123,
    fetchImpl: downloadFetch,
    configuredToken: 'token'
  });

  const buffer = await fs.readFile(downloadResult.packagePath);
  assert.equal(buffer.toString('utf8'), 'zip-content');
  await downloadResult.cleanup();
  await fs.rm(dir, { recursive: true, force: true });
});

test('github release transport resolves an existing release by remoteKey before upload', async () => {
  const { dir, filePath } = await withTempFile();
  const requests = [];

  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.includes('/releases/tags/')) {
      return { ok: true, json: async () => releasePayload({ assets: [] }) };
    }
    if (url.startsWith('https://uploads.github.com/')) {
      return {
        ok: true,
        json: async () => ({
          id: 456,
          name: 'migration.zip',
          browser_download_url: 'https://github.com/octo-org/migration-store/releases/download/claw-migration-main-agent/migration.zip'
        })
      };
    }
    throw new Error(`Unexpected url: ${url}`);
  };

  const result = await upsertPackageToRelease({
    zipPath: filePath,
    manifest: {
      source: { agentId: 'main' },
      createdAt: '2026-03-31T10:00:00.000Z',
      openclawVersion: '2026.3.28'
    },
    owner: 'octo-org',
    repo: 'migration-store',
    remoteKey: 'main-agent',
    fetchImpl,
    configuredToken: 'token'
  });

  assert.equal(result.releaseId, 123);
  assert.equal(requests[0].url.includes('/releases/tags/claw-migration-main-agent'), true);
  await fs.rm(dir, { recursive: true, force: true });
});

test('github release transport deletes an existing asset before re-uploading', async () => {
  const { dir, filePath } = await withTempFile();
  const requests = [];

  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.includes('/releases/tags/')) {
      return { ok: true, json: async () => releasePayload() };
    }
    if (url.endsWith('/releases/assets/456')) {
      return { ok: true, text: async () => '' };
    }
    if (url.startsWith('https://uploads.github.com/')) {
      return {
        ok: true,
        json: async () => ({ id: 789, name: 'migration.zip', browser_download_url: 'https://example.test/migration.zip' })
      };
    }
    throw new Error(`Unexpected url: ${url}`);
  };

  const result = await upsertPackageToRelease({
    zipPath: filePath,
    manifest: {
      source: { agentId: 'main' },
      createdAt: '2026-03-31T10:00:00.000Z',
      openclawVersion: '2026.3.28'
    },
    owner: 'octo-org',
    repo: 'migration-store',
    remoteKey: 'main-agent',
    fetchImpl,
    configuredToken: 'token'
  });

  assert.equal(result.assetId, 789);
  assert.equal(requests.some((request) => request.url.endsWith('/releases/assets/456') && request.options.method === 'DELETE'), true);
  await fs.rm(dir, { recursive: true, force: true });
});

test('github release transport can download by remoteKey without a configured releaseId', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/releases/tags/claw-migration-main-agent')) {
      return { ok: true, json: async () => releasePayload() };
    }
    if (url.endsWith('/releases/assets/456')) {
      return new Response(Buffer.from('zip-content'), {
        status: 200,
        headers: { 'content-length': String(Buffer.byteLength('zip-content')) }
      });
    }
    throw new Error(`Unexpected url: ${url}`);
  };

  const result = await downloadPackageFromRelease({
    owner: 'octo-org',
    repo: 'migration-store',
    remoteKey: 'main-agent',
    fetchImpl,
    configuredToken: 'token'
  });

  assert.equal(result.releaseId, 123);
  const buffer = await fs.readFile(result.packagePath);
  assert.equal(buffer.toString('utf8'), 'zip-content');
  await result.cleanup();
});

test('github release transport builds a stable release tag from remoteKey', () => {
  assert.equal(buildReleaseTag('main-agent'), 'claw-migration-main-agent');
  assert.equal(buildReleaseTag('main/agent prod'), 'claw-migration-main-agent-prod');
});
