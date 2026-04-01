import fs from 'node:fs/promises';
import { DEFAULT_GIST_FILE_NAME, GITHUB_TOKEN_ENV_VARS } from './constants.js';
import { downloadPackageFromGist, upsertPackageToGist } from './gist.js';
import { pathExists } from './utils.js';

function resolveGitHubToken(env = process.env) {
  for (const key of GITHUB_TOKEN_ENV_VARS) {
    if (env[key]) {
      return env[key];
    }
  }
  return null;
}

function createGithubProvider(remoteConfig, dependencies = {}) {
  return {
    async validateConfig() {
      const blockers = [];
      if (!resolveGitHubToken(dependencies.env ?? process.env)) {
        blockers.push('GitHub provider requires OPENCLAW_GITHUB_TOKEN, GITHUB_TOKEN, or GH_TOKEN.');
      }
      return { blockers };
    },
    async previewPush() {
      const notes = [];
      if (!remoteConfig.settings?.gistId) {
        notes.push('Push will create a new private gist because settings.gistId is not configured.');
      }
      return { notes };
    },
    async pushPackage(context) {
      return upsertPackageToGist({
        zipPath: context.zipPath,
        manifest: context.manifest,
        gistId: remoteConfig.settings?.gistId,
        fetchImpl: dependencies.fetchImpl,
        env: dependencies.env
      });
    },
    async previewPull() {
      const blockers = [];
      if (!remoteConfig.settings?.gistId) {
        blockers.push('GitHub pull requires remotes.<name>.settings.gistId.');
      }
      return { blockers };
    },
    async pullPackage() {
      if (!remoteConfig.settings?.gistId) {
        throw new Error('GitHub pull requires remotes.<name>.settings.gistId.');
      }
      return downloadPackageFromGist({
        gistId: remoteConfig.settings.gistId,
        fetchImpl: dependencies.fetchImpl,
        env: dependencies.env
      });
    }
  };
}

function createWebDavProvider() {
  return {
    async validateConfig() {
      return { blockers: ['WebDAV provider is not implemented yet.'] };
    },
    async previewPush() {
      return { blockers: ['WebDAV provider is not implemented yet.'] };
    },
    async pushPackage() {
      throw new Error('WebDAV provider is not implemented yet.');
    },
    async previewPull() {
      return { blockers: ['WebDAV provider is not implemented yet.'] };
    },
    async pullPackage() {
      throw new Error('WebDAV provider is not implemented yet.');
    }
  };
}

export function createProvider(remoteConfig, dependencies = {}) {
  switch (remoteConfig.provider) {
    case 'github':
      return createGithubProvider(remoteConfig, dependencies);
    case 'webdav':
      return createWebDavProvider(remoteConfig, dependencies);
    default:
      return {
        async validateConfig() {
          return { blockers: [`Provider '${remoteConfig.provider}' is not implemented.`] };
        },
        async previewPush() {
          return { blockers: [`Provider '${remoteConfig.provider}' is not implemented.`] };
        },
        async pushPackage() {
          throw new Error(`Provider '${remoteConfig.provider}' is not implemented.`);
        },
        async previewPull() {
          return { blockers: [`Provider '${remoteConfig.provider}' is not implemented.`] };
        },
        async pullPackage() {
          throw new Error(`Provider '${remoteConfig.provider}' is not implemented.`);
        }
      };
  }
}
