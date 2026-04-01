import path from 'node:path';
import { pathExists } from './utils.js';

export async function materializeLocalPackage({ inputPath }) {
  const resolvedPath = path.resolve(inputPath);
  if (!(await pathExists(resolvedPath))) {
    throw new Error(`Migration package not found: ${resolvedPath}`);
  }
  return { packagePath: resolvedPath, cleanup: async () => {} };
}

export async function persistLocalPackage({ zipPath, outputPath }) {
  if (!outputPath) {
    throw new Error('Local export requires --output <zip-path>.');
  }
  return {
    kind: 'local',
    path: path.resolve(outputPath),
    packagePath: zipPath
  };
}
