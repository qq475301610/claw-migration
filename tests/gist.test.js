import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadPackageFromGist, uploadPackageToGist } from '../src/gist.js';

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
