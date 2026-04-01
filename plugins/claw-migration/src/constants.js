export const MIGRATION_SCHEMA = 'openclaw-migration/v1';
export const CORE_WORKSPACE_FILES = [
  'SOUL.md',
  'MEMORY.md',
  'USER.md',
  'AGENTS.md',
  'TOOLS.md',
  'HEARTBEAT.md',
  'IDENTITY.md',
  '.env'
];
export const PACKAGE_ROOT_FILES = ['manifest.json', 'openclaw.json'];
export const EXCLUDED_FILE_NAMES = ['auth.json'];
export const EXCLUDED_PATH_SEGMENTS = [
  'credentials',
  'identity',
  'logs',
  'data',
  'delivery-queue',
  'subagents',
  'browser',
  'canvas',
  'completions',
  'devices',
  'qqbot'
];
export const EXCLUDED_SUFFIXES = ['.sqlite', '.log'];
export const EXCLUDED_PATTERNS = ['.deleted.', '.reset.', '.bak', '.tmp', '.zip'];
export const GITHUB_TOKEN_ENV_VARS = ['OPENCLAW_GITHUB_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN'];
export const DEFAULT_GIST_FILE_NAME = 'migration.zip.base64';
export const DEFAULT_AGENT_DIR_NAME = 'agents';
