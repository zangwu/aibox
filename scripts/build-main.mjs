import * as esbuild from 'esbuild';

/** 主进程 + preload 打包为 CJS（sandboxed preload 要求 CJS） */
await esbuild.build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  outdir: 'electron-dist',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
});
