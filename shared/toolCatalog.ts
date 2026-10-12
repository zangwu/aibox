/**
 * 工具目录：社区高热度精品（Codex / Claude / DeepSeek / Kilo / MiMo）
 * 有 desktop 出桌面卡，有 cmd 出 CLI 卡。
 */
export type ToolEnv = 'openai' | 'anthropic' | 'gemini' | 'none';
export type DesktopChannel = 'ms-store' | 'download' | 'vscode' | 'other';

export interface DesktopDef {
  name: string;
  channel: DesktopChannel;
  storeUrl?: string;
  appxName?: string;
  pathCandidates?: string[];
  shortcutNames?: string[];
  processNames?: string[];
  vscodeExtensionId?: string;
  note?: string;
}

export interface ToolDef {
  id: string;
  name: string;
  vendor: string;
  desc: string;
  managed: boolean;
  agent: boolean;
  cmd?: string;
  extraDirs?: string[];
  npmPackage?: string;
  github?: string;
  website?: string;
  env: ToolEnv;
  official: boolean;
  desktop?: DesktopDef;
  vscodeExtensionId?: string;
}

const LOCAL = '%LOCALAPPDATA%\\Programs';

export const TOOL_CATALOG: ToolDef[] = [
  {
    id: 'codex',
    name: 'Codex',
    vendor: 'OpenAI',
    managed: true,
    agent: true,
    cmd: 'codex',
    npmPackage: '@openai/codex',
    github: 'openai/codex',
    website: 'https://github.com/openai/codex',
    env: 'openai',
    official: true,
    desc: 'OpenAI 官方编程 agent（CLI + 桌面）',
    desktop: {
      name: 'Codex 桌面版',
      channel: 'ms-store',
      appxName: '*codex*',
      storeUrl: 'ms-windows-store://search?query=OpenAI%20Codex',
      processNames: ['ChatGPT.exe', 'codex.exe', 'Codex.exe'],
      note: '微软商店；配置与 CLI 共用 ~/.codex',
    },
  },
  {
    id: 'claude-code',
    name: 'Claude',
    vendor: 'Anthropic',
    managed: true,
    agent: true,
    cmd: 'claude',
    npmPackage: '@anthropic-ai/claude-code',
    github: 'anthropics/claude-code',
    website: 'https://github.com/anthropics/claude-code',
    env: 'anthropic',
    official: true,
    desc: 'Anthropic 官方编程 agent（CLI + Desktop）',
    desktop: {
      name: 'Claude Desktop',
      channel: 'download',
      storeUrl: 'https://claude.ai/download',
      pathCandidates: [
        '%LOCALAPPDATA%\\AnthropicClaude\\claude.exe',
        '%ProgramFiles%\\Claude\\claude.exe',
      ],
      shortcutNames: ['Claude.lnk', 'Claude Desktop.lnk'],
      processNames: ['claude.exe', 'Claude.exe'],
    },
  },
  {
    id: 'deepseek',
    name: 'DeepSeek Harness',
    vendor: '深度求索',
    managed: true,
    agent: true,
    cmd: 'dsh',
    npmPackage: '@deepseek-ai/dsh',
    github: 'deepseek-ai/deepseek-harness',
    website: 'https://www.deepseek.com/harness/',
    env: 'openai',
    official: true,
    desc: '开源 Harness：桌面 + headless CLI，可全自动派单',
    desktop: {
      name: 'DeepSeek Harness 桌面端',
      channel: 'download',
      storeUrl: 'https://download.deepseek.com/desktop/dsh-latest-windows-x64.exe',
      pathCandidates: [
        `${LOCAL}\\DeepSeek Harness\\DeepSeek Harness.exe`,
        'D:\\Users\\admin\\AppData\\Local\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe',
      ],
      shortcutNames: ['DeepSeek Harness.lnk'],
      processNames: ['DeepSeek Harness.exe', 'dsh.exe'],
      note: 'dsh headless 无人值守；预设里的 DeepSeek key 可直接注入',
    },
  },
  {
    id: 'kilo',
    name: 'Kilo Code',
    vendor: 'Kilo',
    managed: false,
    agent: true,
    cmd: 'kilo',
    github: 'Kilo-Org/kilocode',
    website: 'https://kilocode.ai',
    env: 'openai',
    official: true,
    desc: '多模型编码 agent：VS Code 插件 + CLI',
    vscodeExtensionId: 'kilocode.kilo-code',
    desktop: {
      name: 'Kilo Code（VS Code）',
      channel: 'vscode',
      vscodeExtensionId: 'kilocode.kilo-code',
      storeUrl: 'https://marketplace.visualstudio.com/items?itemName=kilocode.kilo-code',
      note: '装机量高；可拉起 VS Code',
    },
  },
  {
    id: 'mimo',
    name: 'MiMo',
    vendor: '小米',
    managed: false,
    agent: true,
    github: 'XiaomiMiMo/MiMo',
    website: 'https://github.com/XiaomiMiMo',
    env: 'openai',
    official: true,
    desc: '小米 MiMo：桌面客户端接入，OpenAI 兼容端点',
    desktop: {
      name: 'MiMo 桌面版',
      channel: 'download',
      storeUrl: 'https://github.com/XiaomiMiMo',
      processNames: ['MiMo.exe', 'mimo.exe'],
      note: '按官方分发安装',
    },
  },
];

export const MANAGED_TOOL_IDS = TOOL_CATALOG.filter((t) => t.managed).map((t) => t.id);
export const DESKTOP_TOOL_IDS = TOOL_CATALOG.filter((t) => Boolean(t.desktop)).map((t) => t.id);

export function findTool(id: string): ToolDef | undefined {
  return TOOL_CATALOG.find((t) => t.id === id);
}

export const AGENT_ARGS: Record<string, (p: string, hasHistory: boolean) => string[]> = {
  codex: (p, h) =>
    h ? ['exec', '--skip-git-repo-check', 'resume', '--last', p] : ['exec', '--skip-git-repo-check', p],
  'claude-code': (p, h) => ['-p', ...(h ? ['--continue'] : []), p],
  deepseek: (p) => ['headless', p],
  kilo: (p) => ['run', p],
  mimo: (p) => [p],
};
