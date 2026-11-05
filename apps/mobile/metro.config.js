const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Монорепозиторий (рецепт Expo): следим за корнем воркспейса, чтобы Metro видел
// пакеты packages/* и обновления зависимостей, а модули резолвим из node_modules
// приложения и корня.
//
// Примечание для Linux: набор файловых вотчеров может упереться в системный лимит
// (fs.inotify.max_user_watches). Решения: поднять лимит
//   sudo sysctl -w fs.inotify.max_user_watches=1048576
// или установить Watchman — Metro подхватит его автоматически.
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
