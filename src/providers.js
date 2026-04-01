import { GITHUB_TOKEN_ENV_VARS } from './constants.js';
import { downloadPackageFromGist, upsertPackageToGist } from './gist.js';

function resolveGitHubToken(remoteConfig, env = process.env) {
  const configuredToken = remoteConfig.settings?.token;
  if (configuredToken) {
    return configuredToken;
  }
  for (const key of GITHUB_TOKEN_ENV_VARS) {
    if (env[key]) {
      return env[key];
    }
  }
  return null;
}

function getRemoteLocator(remoteConfig, context = {}) {
  return {
    gistId: remoteConfig.settings?.gistId ?? null,
    remoteKey: remoteConfig.settings?.remoteKey ?? context.options?.agentId ?? null,
    token: remoteConfig.settings?.token ?? null
  };
}

function createGithubProvider(remoteConfig, dependencies = {}) {
  return {
    async validateConfig() {
      const blockers = [];
      if (!resolveGitHubToken(remoteConfig, dependencies.env ?? process.env)) {
        blockers.push('GitHub provider requires remotes.<name>.settings.token or OPENCLAW_GITHUB_TOKEN, GITHUB_TOKEN, or GH_TOKEN.');
      }
      return { blockers };
    },
    async previewPush(context) {
      const notes = [];
      const locator = getRemoteLocator(remoteConfig, context);
      if (locator.remoteKey) {
        notes.push(`Push will reuse or create the GitHub gist associated with remoteKey '${locator.remoteKey}'.`);
      } else if (!locator.gistId) {
        notes.push('Push will create a new private gist because neither settings.remoteKey nor settings.gistId is configured.');
      } else {
        notes.push(`Push will update the configured gistId '${locator.gistId}'.`);
      }
      return { notes };
    },
    async pushPackage(context) {
      const locator = getRemoteLocator(remoteConfig, context);
      return upsertPackageToGist({
        zipPath: context.zipPath,
        manifest: context.manifest,
        gistId: locator.gistId,
        remoteKey: locator.remoteKey,
        configuredToken: locator.token,
        fetchImpl: dependencies.fetchImpl,
        env: dependencies.env
      });
    },
    async previewPull(context) {
      const blockers = [];
      const notes = [];
      const locator = getRemoteLocator(remoteConfig, context);
      if (!locator.gistId && !locator.remoteKey) {
        blockers.push('GitHub pull requires remotes.<name>.settings.remoteKey or remotes.<name>.settings.gistId.');
      } else if (locator.remoteKey && !locator.gistId) {
        notes.push(`Pull will resolve the latest gist for remoteKey '${locator.remoteKey}'.`);
      }
      return { blockers, notes };
    },
    async pullPackage(context) {
      const locator = getRemoteLocator(remoteConfig, context);
      if (!locator.gistId && !locator.remoteKey) {
        throw new Error('GitHub pull requires remotes.<name>.settings.remoteKey or remotes.<name>.settings.gistId.');
      }
      return downloadPackageFromGist({
        gistId: locator.gistId,
        remoteKey: locator.remoteKey,
        configuredToken: locator.token,
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
      return createWebDavProvider();
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
