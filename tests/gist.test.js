import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadPackageFromGist, findGistByRemoteKey, uploadPackageToGist } from '../src/gist.js';

async function withTempFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gist-test-'));
  const filePath = path.join(dir, 'migration.zip');
  await fs.writeFile(filePath, Buffer.from('zip-content'));
  return { dir, filePath };
}

test('gist transport uploads and downloads base64 zip payloads', async () => {
  const { dir, filePath } = await withTempFile();
  const requests = [];

  const uploadFetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      json: async () => ({ id: 'gist-123', html_url: 'https://gist.github.com/example/gist-123' })
    };
  };

  const uploadResult = await uploadPackageToGist({
    zipPath: filePath,
    manifest: {
      source: { agentId: 'main' },
      createdAt: '2026-03-31T10:00:00.000Z',
      openclawVersion: '2026.3.28'
    },
    fetchImpl: uploadFetch,
    env: { GITHUB_TOKEN: 'token' }
  });

  assert.equal(uploadResult.id, 'gist-123');
  const uploadBody = JSON.parse(requests[0].options.body);
  assert.ok(uploadBody.files['migration.zip.base64'].content.length > 0);

  const downloadFetch = async () => ({
    ok: true,
    json: async () => ({
      files: {
        'migration.zip.base64': {
          content: Buffer.from('zip-content').toString('base64')
        }
      }
    })
  });

  const downloadResult = await downloadPackageFromGist({
    gistId: 'gist-123',
    fetchImpl: downloadFetch,
    env: { GITHUB_TOKEN: 'token' }
  });

  const buffer = await fs.readFile(downloadResult.packagePath);
  assert.equal(buffer.toString('utf8'), 'zip-content');
  await downloadResult.cleanup();
  await fs.rm(dir, { recursive: true, force: true });
});

test('gist transport downloads truncated base64 files through raw_url', async () => {
  const fetchImpl = async (url) => {
    if (url === 'https://api.github.com/gists/gist-large') {
      return {
        ok: true,
        json: async () => ({
          files: {
            'migration.zip.base64': {
              truncated: true,
              raw_url: 'https://gist.githubusercontent.com/example/raw/migration.zip.base64',
              content: 'partial'
            }
          }
        })
      };
    }

    if (url === 'https://gist.githubusercontent.com/example/raw/migration.zip.base64') {
      return {
        ok: true,
        text: async () => Buffer.from('zip-content').toString('base64')
      };
    }

    throw new Error(`Unexpected url: ${url}`);
  };

  const result = await downloadPackageFromGist({
    gistId: 'gist-large',
    fetchImpl,
    env: { GITHUB_TOKEN: 'token' }
  });

  const buffer = await fs.readFile(result.packagePath);
  assert.equal(buffer.toString('utf8'), 'zip-content');
  await result.cleanup();
});

test('gist transport resolves an existing gist by remoteKey before upload', async () => {
  const { dir, filePath } = await withTempFile();
  const requests = [];

  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if ((options.method ?? 'GET') === 'PATCH') {
      return {
        ok: true,
        json: async () => ({ id: 'gist-remote', html_url: 'https://gist.github.com/example/gist-remote' })
      };
    }

    return {
      ok: true,
      json: async () => ([
        { id: 'gist-remote', html_url: 'https://gist.github.com/example/gist-remote', description: 'OpenClaw migration:main-agent:main:2026-03-31T10:00:00.000Z:2026.3.28' }
      ])
    };
  };

  const result = await uploadPackageToGist({
    zipPath: filePath,
    manifest: {
      source: { agentId: 'main' },
      createdAt: '2026-03-31T10:00:00.000Z',
      openclawVersion: '2026.3.28'
    },
    remoteKey: 'main-agent',
    fetchImpl,
    env: { GITHUB_TOKEN: 'token' }
  });

  assert.equal(result.id, 'gist-remote');
  assert.equal(requests[0].url.includes('/gists?per_page=100&page=1'), true);
  assert.equal(requests[1].url.endsWith('/gists/gist-remote'), true);
  await fs.rm(dir, { recursive: true, force: true });
});

test('gist transport can download by remoteKey without a configured gistId', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/gists?per_page=100&page=1')) {
      return {
        ok: true,
        json: async () => ([
          { id: 'gist-remote', html_url: 'https://gist.github.com/example/gist-remote', description: 'OpenClaw migration:main-agent:main:2026-03-31T10:00:00.000Z:2026.3.28' }
        ])
      };
    }

    return {
      ok: true,
      json: async () => ({
        files: {
          'migration.zip.base64': {
            content: Buffer.from('zip-content').toString('base64')
          }
        }
      })
    };
  };

  const result = await downloadPackageFromGist({
    remoteKey: 'main-agent',
    fetchImpl,
    env: { GITHUB_TOKEN: 'token' }
  });

  assert.equal(result.gistId, 'gist-remote');
  const buffer = await fs.readFile(result.packagePath);
  assert.equal(buffer.toString('utf8'), 'zip-content');
  await result.cleanup();
});

test('gist transport exposes a lookup helper for remoteKey', async () => {
  const result = await findGistByRemoteKey({
    remoteKey: 'main-agent',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ([
        { id: 'gist-remote', html_url: 'https://gist.github.com/example/gist-remote', description: 'OpenClaw migration:main-agent:main:2026-03-31T10:00:00.000Z:2026.3.28' }
      ])
    }),
    env: { GITHUB_TOKEN: 'token' }
  });

  assert.equal(result.id, 'gist-remote');
});
