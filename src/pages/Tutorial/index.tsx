import { Card } from '../../components/ui';

const SECTIONS = [
  {
    title: '一分钟上手',
    items: [
      '去中转站官网注册、充值，拿到 API Key（预设卡片上的「前往」按钮直达官网）',
      '在「预设市场」新建预设：填名称、Base URL、协议、模型，粘贴 key 保存（保存时自动做连通性测试）',
      '到「工具面板」选择对应客户端卡片，下拉框选中预设 —— 盒子自动完成：测试 → 写入配置 → 重启客户端',
      '对话发生在 Codex / Claude Code 自己的窗口里，盒子只做管理',
    ],
  },
  {
    title: '预设与 key',
    items: [
      '「✓ 已验证」= key 通过过连通性测试；「未验证」= 还没测过，点击即可重新验证',
      'key 只保存在本机 %APPDATA%\\aibox\\config.json，不上传、不进分享码',
      '切换预设时会先测连通性：通过才写入；不通过可「重试」或「仍然写入并重启」',
      '内置预设只含公开 base_url 模板，key 需自备；「前往」跳转官网购买',
    ],
  },
  {
    title: '工具面板',
    items: [
      '桌面版与 CLI 是两张独立卡片，顶部可按类型筛选',
      '下拉框只显示「支持本工具 + 已存 key」的预设；客户端未安装时下拉禁用，先安装',
      '琥珀色「重启生效」按钮 = 配置已写入，点击一键关闭并重启对应客户端',
      '「应用并重启」= 用当前选中预设再写入一遍并重启（换 key 后用）',
    ],
  },
  {
    title: '常见问题',
    items: [
      '502 / 连接失败：中转站服务端问题，与盒子无关，联系中转站或稍后重试',
      '鉴权失败（401/403）：key 错误、过期或余额不足',
      'Codex 提示删除 auth.json：那是旧登录凭据，可能优先于新 key 生效，按提示删除即可（删除前有备份）',
      '写入后工具没变化：点「重启生效」；环境变量对新开的终端才生效',
      '配置写错想恢复：各配置文件旁边有 *.aibox-backup 备份',
    ],
  },
  {
    title: '数据与边界',
    items: [
      '本工具无后端、无账号、不代理任何 AI 请求，只做本地配置文件编辑',
      '支持订阅预设源（JSON）与 aibox1: 分享码导入；收藏/备注/评分仅存本机',
      '卸载盒子不会删除已写入各工具的配置（那是各工具自己的文件）',
    ],
  },
];

export default function Tutorial() {
  return (
    <div className="h-full overflow-y-auto p-5">
      <h1 className="mb-1 text-lg font-semibold text-slate-800">使用教程</h1>
      <p className="mb-4 text-xs text-slate-500">从拿到 key 到跑通对话的完整流程，以及常见问题的自助排查</p>
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
