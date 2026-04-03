import { buildReleaseTag, downloadPackageFromRelease, upsertPackageToRelease } from './github-release.js';

function resolveGitHubToken(remoteConfig) {
  return remoteConfig.settings?.token ?? null;
}

function getRemoteLocator(remoteConfig, context = {}) {
  return {
    owner: remoteConfig.settings?.owner ?? null,
    repo: remoteConfig.settings?.repo ?? null,
    releaseId: remoteConfig.settings?.releaseId ?? null,
    remoteKey: remoteConfig.settings?.remoteKey ?? context.options?.agentId ?? null,
    token: remoteConfig.settings?.token ?? null
  };
}

function createGithubProvider(remoteConfig, dependencies = {}) {
  return {
    async validateConfig() {
      const blockers = [];
      if (!resolveGitHubToken(remoteConfig)) {
        blockers.push('GitHub provider requires remotes.<name>.settings.token.');
      }
      if (!remoteConfig.settings?.owner) {
        blockers.push('GitHub provider requires remotes.<name>.settings.owner.');
      }
      if (!remoteConfig.settings?.repo) {
        blockers.push('GitHub provider requires remotes.<name>.settings.repo.');
      }
      return { blockers };
    },
    async previewPush(context) {
      const notes = [];
      const locator = getRemoteLocator(remoteConfig, context);
      if (locator.remoteKey) {
        notes.push(`Push will create or update the GitHub release tagged '${buildReleaseTag(locator.remoteKey)}' in ${locator.owner}/${locator.repo}.`);
      }
      return { notes };
    },
    async pushPackage(context) {
      const locator = getRemoteLocator(remoteConfig, context);
      return upsertPackageToRelease({
        zipPath: context.zipPath,
        manifest: context.manifest,
        owner: locator.owner,
        repo: locator.repo,
        releaseId: locator.releaseId,
        remoteKey: locator.remoteKey,
        configuredToken: locator.token,
        fetchImpl: dependencies.fetchImpl,
        onProgress: context.onProgress
      });
    },
    async previewPull(context) {
      const blockers = [];
      const notes = [];
      const locator = getRemoteLocator(remoteConfig, context);
      if (!locator.remoteKey && !locator.releaseId) {
        blockers.push('GitHub pull requires remotes.<name>.settings.remoteKey or remotes.<name>.settings.releaseId.');
      } else if (locator.remoteKey) {
        notes.push(`Pull will resolve the GitHub release tagged '${buildReleaseTag(locator.remoteKey)}' in ${locator.owner}/${locator.repo}.`);
      }
      return { blockers, notes };
    },
    async pullPackage(context) {
      const locator = getRemoteLocator(remoteConfig, context);
      if (!locator.remoteKey && !locator.releaseId) {
        throw new Error('GitHub pull requires remotes.<name>.settings.remoteKey or remotes.<name>.settings.releaseId.');
      }
      return downloadPackageFromRelease({
        owner: locator.owner,
        repo: locator.repo,
        releaseId: locator.releaseId,
        remoteKey: locator.remoteKey,
        configuredToken: locator.token,
        fetchImpl: dependencies.fetchImpl,
        onProgress: context.onProgress
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
