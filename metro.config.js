const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Privy's React Native dependency graph contains a few packages whose export
// maps do not yet resolve correctly under Metro. Keep Metro's default resolver
// for everything else so Expo SDK 57 behavior is preserved.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'isows' || moduleName.startsWith('zustand')) {
    const compatibleContext = { ...context, unstable_enablePackageExports: false };
    return compatibleContext.resolveRequest(compatibleContext, moduleName, platform);
  }
  if (moduleName === 'jose') {
    const browserContext = { ...context, unstable_conditionNames: ['browser'] };
    return browserContext.resolveRequest(browserContext, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
