import { Card } from '../../components/ui';

const SECTIONS = [
  {
    title: '一分钟上手',
    items: [
      '去中转站/模型平台注册并拿到 API Key',
      '「预设市场」→ 新建预设：Base URL、协议、模型、粘贴 key 保存（自动测连通性）',
      '「工具面板」选客户端卡片，下拉选预设 → 自动写入配置并提示重启',
      '对话在 Codex / Claude / DeepSeek 等客户端里进行，盒子负责配置与管理',
    ],
  },
  {
    title: '预设与 Key',
    items: [
      '✓ 已验证 = key 测过连通性；点徽章可重测',
      'key 只存在本机，分享码 aibox1: 不含 key',
      '切换预设：先测连通，通过才写入；失败可重试或仍强制写入',
      '内置预设仅模板；个人中转站请本地自建，勿提交到公开仓库',
    ],
  },
  {
    title: '工具面板',
    items: [
      '桌面版 / CLI 双卡片，有啥形态出啥卡；可按「已收藏 / 桌面版 / CLI」筛选',
      '热度 = 公开调用量（npm 周下载 / Stars / VS Code 安装），按热度排序',
      '已装工具可「卸载」；未装可「一键安装 / 商店下载」',
      '爱心收藏卡片；列表按热度高低排列',
    ],
  },
  {
    title: '研发工作流',
    items: [
      '「研发」→ 新建项目（创建本地目录，数据在 .aibox/）',
      '新建工作项：需求/任务/测试/缺陷，选阶段与功能模块',
      '详情：生成简报 / 发送到 DeepSeek Harness / 全自动执行',
      '人审「通过 / 不通过」；通过记 G5 关闭任务',
      '打开目录可到资源管理器查看项目根',
    ],
  },
  {
    title: 'DeepSeek Harness',
    items: [
      '「发送到 Harness」：自动切工作区、新会话、注入任务并发送',
      '全自动：dsh headless，key 从预设市场 DeepSeek 预设注入',
      '工作区校验失败会中止，避免写错项目',
    ],
  },
  {
    title: '更新与安装',
    items: [
      '左下角出现「发现新版」时可一键更新（GitHub / Gitee 双源）',
      '设置页可手动「检查更新」「重启安装」',
      'Windows 安装包 aibox-setup.exe；热更走 latest.yml',
    ],
  },
  {
    title: '常见问题',
    items: [
      '连不上：检查网络/中转站；鉴权 401/403 查 key 与额度',
      '写入后工具没变：点「重启生效」；环境变量对新终端才生效',
      '卸载盒子不会删各工具自己的配置文件',
    ],
  },
];

export default function Tutorial() {
  return (
    <div className="h-full overflow-y-auto p-5">
      <h1 className="mb-1 text-lg font-semibold text-slate-800">使用教程</h1>
      <p className="mb-4 text-xs text-slate-500">
        从配置 key、工具管理到研发工作流与热更新的完整说明
      </p>
      <div className="grid max-w-4xl grid-cols-1 gap-3">
        {SECTIONS.map((s) => (
          <Card key={s.title} title={s.title} dense>
            <ol className="list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-slate-600">
              {s.items.map((it, i) => (
                <li key={i}>{it}</li>
              ))}
            </ol>
          </Card>
        ))}
      </div>
    </div>
  );
}
