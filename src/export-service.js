import fs from 'node:fs/promises';
import path from 'node:path';
import { zipDirectory } from './archive.js';
import { uploadPackageToGist } from './gist.js';
import { persistLocalPackage } from './local.js';
import { stageMigrationPackage } from './migration-package.js';
import { makeTempDir, removeIfExists } from './utils.js';

export async function createMigrationArchive(options) {
  const { stagingDir, manifest } = await stageMigrationPackage(options);
  const tempOutputDir = await makeTempDir('openclaw-migration-output-');
  const zipPath = path.join(tempOutputDir, `${options.agentId}-migration.zip`);
  await zipDirectory(stagingDir, zipPath);

  return {
    zipPath,
    manifest,
    cleanup: async () => {
      await removeIfExists(stagingDir);
      await removeIfExists(tempOutputDir);
    }
  };
}

export async function exportMigrationPackage(options) {
  const archive = await createMigrationArchive(options);

  try {
    if (options.to === 'gist') {
      const gistResult = await uploadPackageToGist({ zipPath: archive.zipPath, manifest: archive.manifest, fetchImpl: options.fetchImpl, env: options.env });
      return {
        ...gistResult,
        manifest: archive.manifest
      };
    }

    const localResult = await persistLocalPackage({ zipPath: archive.zipPath, outputPath: options.outputPath });
    await fs.copyFile(archive.zipPath, localResult.path);
    return {
      kind: 'local',
      path: localResult.path,
      manifest: archive.manifest
    };
  } finally {
    await archive.cleanup();
  }
}
