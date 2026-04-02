import { exportMigrationPackage, createMigrationArchive } from './export-service.js';
import { previewMigrationImport, verifyMigrationPackage } from './preview-service.js';
import { importMigrationPackage } from './import-service.js';
import {
  previewPush,
  pushAgentMigration,
  previewPull,
  pullAgentMigration,
  verifyMigration,
  formatActionPreview,
  formatVerification
} from './workflow.js';
import { formatPreview, formatVerify } from './format.js';
import { seedPluginConfigFile } from './plugin-config.js';
import { installMigrationSkill, registerMigrationCli, runMigrationDoctor, runMigrationSetup } from './setup-cli.js';

export async function register(api = {}) {
  try {
    await seedPluginConfigFile({ config: api.config, runtime: api.runtime });
  } catch (error) {
    api.logger?.warn?.(`Failed to seed Claw Migration defaults: ${error.message}`);
  }

  registerMigrationCli(api);
}

export {
  createMigrationArchive,
  exportMigrationPackage,
  previewMigrationImport,
  verifyMigrationPackage,
  importMigrationPackage,
  previewPush,
  pushAgentMigration,
  previewPull,
  pullAgentMigration,
  verifyMigration,
  formatActionPreview,
  formatVerification,
  formatPreview,
  formatVerify,
  runMigrationSetup,
  installMigrationSkill,
  runMigrationDoctor
};

export default {
  id: 'claw-migration',
  name: 'Claw Migration',
  description: 'Move a single OpenClaw agent between devices through remote migration packages.',
  register
};


