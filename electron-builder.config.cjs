module.exports = {
  appId: 'com.aibox.app',
  productName: 'AI Box',
  directories: { output: 'release' },
  files: ['electron-dist/**/*', 'dist/**/*', 'package.json'],
  asar: true,
  // 自动更新源：Gitee Releases 固定地址（发版脚本替换 latest 标签附件）
  // GITEE_PUBLISH_URL 环境变量可覆盖，用于切换镜像/调试
  publish: [
    {
      provider: 'generic',
      url: process.env.AIBOX_UPDATE_URL || 'https://github.com/YOUR_GITHUB_USER/aibox/releases/download/latest',
    },
  ],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.ico',
    artifactName: 'aibox-setup.${ext}',
    // rcedit 改由 afterPack 钩子带重试执行（规避安全软件瞬时锁定）
    signAndEditExecutable: false,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    shortcutName: 'AI Box',
    createDesktopShortcut: true,
  },
  afterPack: './scripts/afterPack.cjs',
};
