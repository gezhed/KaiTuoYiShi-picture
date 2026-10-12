import { useRef, useState } from 'react';
import type { LLM条目, LLM预设, LLM设置 } from '@/models/genSystem';
import { 面板, 提示条, 次级按钮, 开关行, 设置字段 as 字段 } from '@/components/features/Settings/settingsPrimitives';

/**
 * LLM设置。
 *
 * 这个面板之前**完全不存在**——数据模型、读写路径、错误提示都在，
 * 但没有任何界面可以配置它，于是「生成本回合插图」必然失败，
 * 而报错让用户「去启用 LLM 预设并填写模型接口」，用户却无处可去。
 *
 * LLM的职责：把正文变成若干条插图提示词（每条带一个锚点行）。
 * 提示词质量直接取决于这里的预设内容——这也是「AI 写给正文的生图提示词质量过低」
 * 的根因所在，所以预设的导入与启停必须可操作。
 */
export function LlmSettingsPanel({
  LLM,
  onChange,
  /** 主 API 配置，用于展示「留空即回退」的实际取值。 */
  主配置名,
  主配置模型,
  主配置地址,
}: {
  LLM: LLM设置;
  onChange: (下一项: LLM设置) => void;
  /** 主接口的名称/模型/地址，留空回退时给用户看会用到什么。 */
  主配置名?: string;
  主配置模型?: string;
  主配置地址?: string;
}) {
  const [提示, set提示] = useState<{ kind: 'info' | 'ok' | 'error'; text: string } | null>(null);
  /** 正在编辑的条目 id；null 表示都在只读展示。 */
  const [编辑中, set编辑中] = useState<string | null>(null);
  /** 编辑中的条目内容草稿；保存前不动设置。 */
  const [草稿, set草稿] = useState('');
  const 文件输入 = useRef<HTMLInputElement | null>(null);

  const 补丁 = (部分: Partial<LLM设置>) => onChange({ ...LLM, ...部分 });
  const 补丁API = (部分: Partial<LLM设置['API']>) => 补丁({ API: { ...LLM.API, ...部分 } });

  const 预设名列表 = Object.keys(LLM.预设列表);
  const 当前预设: LLM预设 | undefined = LLM.预设列表[LLM.当前预设];
  const 启用条目数 = (当前预设?.entries ?? []).filter((项) => 项.enabled !== false).length;

  const 补丁当前预设 = (部分: Partial<LLM预设>) => {
    if (!当前预设) return;
    补丁({ 预设列表: { ...LLM.预设列表, [LLM.当前预设]: { ...当前预设, ...部分 } } });
  };

  const 切换条目 = (条目Id: string) => {
    补丁当前预设({
      entries: (当前预设?.entries ?? []).map((项) => (
        项.id === 条目Id ? { ...项, enabled: 项.enabled === false } : 项
      )),
    });
  };

  /** 导入社区预设：接受单条数组、`{ entries: [...] }`、或整份预设表。 */
  const 处理导入预设 = async (文件列表: FileList | null) => {
    if (!文件列表 || 文件列表.length === 0) return;
    const 新增: Record<string, LLM预设> = {};
    const 失败: string[] = [];
    for (const 文件 of Array.from(文件列表)) {
      try {
        const 解析 = JSON.parse(await 文件.text()) as unknown;
        const 预设表 = 归一化导入(解析, 文件.name);
        const 名称列表 = Object.keys(预设表);
        if (名称列表.length === 0) {
          失败.push(`${文件.name}：文件里没有可用的条目`);
          continue;
        }
        for (const 名称 of 名称列表) {
          // 同名时加后缀，避免悄悄覆盖用户已有预设。
          const 最终名 = LLM.预设列表[名称] || 新增[名称] ? `${名称}（导入）` : 名称;
          新增[最终名] = 预设表[名称];
        }
      } catch (错误) {
        失败.push(`${文件.name}：${错误 instanceof Error ? 错误.message : String(错误)}`);
      }
    }
    const 条目数 = Object.keys(新增).length;
    if (条目数 === 0) {
      set提示({
        kind: 'error',
        text: 失败.length > 0
          ? `导入失败：\n${失败.join('\n')}`
          : '没有从文件里读到任何条目。支持含 entries 数组的 JSON。',
      });
      return;
    }
    补丁({ 预设列表: { ...LLM.预设列表, ...新增 }, 当前预设: Object.keys(新增)[0] });
    set提示({
      kind: 'ok',
      text: `导入成功：${条目数} 个预设，已切换过去。`
        + (失败.length > 0 ? `\n部分文件失败：\n${失败.join('\n')}` : ''),
    });
  };

  return (
    <div className="space-y-4">
      <面板
        title="LLM"
        desc="把正文变成插图提示词。不启用它，「生成本回合插图」与正文自动配图都无法工作。"
      >
        <开关行
          label="启用 LLM 预设"
          desc="关闭时正文配图会直接报错；手动出图不受影响。"
          checked={LLM.启用}
          onChange={(值) => 补丁({ 启用: 值 })}
        />

        <div className="grid gap-3 md:grid-cols-2">
          <字段 label="接口类型" hint="留空即回退到主 API 的接口类型。">
            <input
              className="kaituo-input w-full px-3 py-2 text-sm"
              value={LLM.API.provider}
              placeholder="留空回退主 API"
              onChange={(事件) => 补丁API({ provider: 事件.target.value })}
            />
          </字段>
          <字段
            label="模型"
            hint={主配置模型 ? `留空回退主 API 的模型（${主配置模型}）。` : '留空回退主 API 的模型；主 API 未配模型时必须在这里填。'}
          >
            <input
              className="kaituo-input w-full px-3 py-2 text-sm font-mono"
              value={LLM.API.model}
              placeholder={主配置模型 || '例如 gpt-4o-mini'}
              onChange={(事件) => 补丁API({ model: 事件.target.value })}
            />
          </字段>
          <字段
            label="接口地址"
            hint={主配置地址 ? `留空回退主 API（${主配置地址}）。` : '留空回退主 API 的地址。'}
          >
            <input
              className="kaituo-input w-full px-3 py-2 text-sm font-mono"
              value={LLM.API.baseUrl}
              placeholder={主配置地址 || 'https://api.openai.com/v1'}
              onChange={(事件) => 补丁API({ baseUrl: 事件.target.value })}
            />
          </字段>
          <字段 label="API Key" hint="留空回退主 API 的 Key。">
            <input
              type="password"
              className="kaituo-input w-full px-3 py-2 text-sm font-mono"
              value={LLM.API.apiKey}
              placeholder="留空回退主 API"
              onChange={(事件) => 补丁API({ apiKey: 事件.target.value })}
            />
          </字段>
          <字段 label="温度" hint="越低越稳定；这一项只影响提示词生成。">
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              className="kaituo-input w-full px-3 py-2 text-sm"
              value={LLM.温度}
              onChange={(事件) => 补丁({ 温度: Number(事件.target.value) })}
            />
          </字段>
          <字段 label="重试次数" hint="模型没按格式回复时自动重问几次。">
            <input
              type="number"
              min={0}
              max={5}
              className="kaituo-input w-full px-3 py-2 text-sm"
              value={LLM.重试次数}
              onChange={(事件) => 补丁({ 重试次数: Math.max(0, Number(事件.target.value) || 0) })}
            />
          </字段>
          <字段
            label="最大输出（token）"
            hint="一次回复的输出上限。给太小会在半途被截断，截断的回复里常连一个完整的 image###…### 都没有，看起来就像「没输出」。"
          >
            <input
              type="number"
              min={256}
              step={1024}
              className="kaituo-input w-full px-3 py-2 text-sm"
              value={LLM.最大输出}
              onChange={(事件) => 补丁({ 最大输出: Math.max(256, Number(事件.target.value) || 256) })}
            />
          </字段>
        </div>

        {/* 关键判据：模型或地址都取不到时，运行期会直接判为「未配置」。 */}
        {LLM.启用 && !LLM.API.model.trim() && !主配置模型 ? (
          <提示条
            kind="error"
            text="LLM已启用，但没有可用的模型：这里没填，主 API 也没有。正文配图会报「LLM未配置」。"
          />
        ) : null}
        {LLM.启用 && !LLM.API.baseUrl.trim() && !主配置地址 ? (
          <提示条 kind="info" text="接口地址留空且主 API 未配地址：请在这里填写。" />
        ) : null}
      </面板>

      <面板
        title={`LLM预设（${预设名列表.length} 个）`}
        desc="预设决定「怎么问模型」。默认预设是空的，需要导入社区预设或自己写条目。"
      >
        {预设名列表.length > 0 ? (
          <字段 label="当前预设" hint="只影响正文配图，不影响手动出图。">
            <select
              className="kaituo-input w-full px-3 py-2 text-sm"
              value={LLM.当前预设}
              onChange={(事件) => 补丁({ 当前预设: 事件.target.value })}
            >
              {预设名列表.map((项) => (
                <option key={项} value={项}>
                  {项}（{(LLM.预设列表[项]?.entries ?? []).length} 条）
                </option>
              ))}
            </select>
          </字段>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <次级按钮 onClick={() => 文件输入.current?.click()}>导入预设文件</次级按钮>
          <次级按钮
            onClick={() => {
              const 名称 = `预设${预设名列表.length + 1}`;
              const 时间 = Date.now();
              补丁({
                预设列表: { ...LLM.预设列表, [名称]: { entries: [], createdAt: 时间, updatedAt: 时间 } },
                当前预设: 名称,
              });
            }}
          >
            新建空预设
          </次级按钮>
          {预设名列表.length > 1 ? (
            <次级按钮
              onClick={() => {
                const 剩余 = 预设名列表.filter((项) => 项 !== LLM.当前预设);
                const { [LLM.当前预设]: _丢弃, ...其余 } = LLM.预设列表;
                补丁({ 预设列表: 其余, 当前预设: 剩余[0] ?? '' });
              }}
            >
              删除当前预设
            </次级按钮>
          ) : null}
        </div>
        <input
          ref={文件输入}
          type="file"
          accept="application/json,.json"
          multiple
          className="hidden"
          onChange={(事件) => {
            void 处理导入预设(事件.target.files);
            事件.target.value = '';
          }}
        />

        {提示 ? <提示条 kind={提示.kind} text={提示.text} /> : null}

        {启用条目数 === 0 ? (
          <提示条
            kind="error"
            text={'当前预设没有任何启用的条目，正文配图会报「LLM 预设没有任何启用的条目」。'
              + '请导入社区预设，或新建预设后至少写入一条启用的 system 条目。'}
          />
        ) : (
          <提示条 kind="ok" text={`当前预设启用 ${启用条目数} 条，正文配图可用。`} />
        )}

        {(当前预设?.entries ?? []).length > 0 ? (
          <字段 label="条目（点标题可启停）">
            {/*
              条目可能上百条（社区预设实测 184 条）。不限制高度会把整个设置页撑到
              几万像素，翻页时根本找不到下面的按钮，因此固定高度 + 内部滚动。
            */}
            <div
              className="max-h-96 space-y-1 overflow-y-auto pr-1"
              style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))', padding: '4px' }}
            >
              {(当前预设?.entries ?? []).map((条目: LLM条目, 下标: number) => {
                const 正在编辑 = 编辑中 === 条目.id;
                return (
                  <div
                    key={条目.id || 下标}
                    className="px-2 py-1.5"
                    style={{
                      border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))',
                      opacity: 条目.enabled === false && !正在编辑 ? 0.5 : 1,
                    }}
                  >
                    <div className="flex items-center gap-2 text-[11px]">
                      <button
                        type="button"
                        onClick={() => 切换条目(条目.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left transition-all hover:opacity-85"
                        title="点击启停"
                      >
                        <span className="font-mono" style={{ color: 'rgb(var(--tj-accent-primary))' }}>
                          {条目.role}
                        </span>
                        <span className="truncate font-serif" style={{ color: 'rgba(var(--tj-text-primary), 0.88)' }}>
                          {条目.name || `条目 ${下标 + 1}`}
                        </span>
                        <span className="shrink-0" style={{ color: 'rgba(var(--tj-text-secondary), 0.7)' }}>
                          {条目.enabled === false ? '已停用' : '已启用'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          set编辑中(正在编辑 ? null : 条目.id);
                          set草稿(条目.content);
                        }}
                        className="shrink-0 px-1.5 transition-all hover:opacity-80"
                        style={{ color: 'rgba(var(--tj-text-primary), 0.8)' }}
                      >
                        {正在编辑 ? '取消' : '编辑'}
                      </button>
                    </div>

                    {正在编辑 ? (
                      <div className="mt-1.5">
                        {/* 条目内容是预设的核心，必须能改：社区预设常需要按自己的模型微调。 */}
                        <textarea
                          className="kaituo-input h-40 w-full px-2 py-1.5 text-[11px] leading-relaxed font-mono"
                          value={草稿}
                          spellCheck={false}
                          onChange={(事件) => set草稿(事件.target.value)}
                        />
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <次级按钮
                            onClick={() => {
                              补丁当前预设({
                                entries: (当前预设?.entries ?? []).map((项) => (
                                  项.id === 条目.id ? { ...项, content: 草稿 } : 项
                                )),
                              });
                              set编辑中(null);
                              set提示({ kind: 'ok', text: `已保存「${条目.name || 条目.id}」的内容。` });
                            }}
                          >
                            保存
                          </次级按钮>
                          <次级按钮 onClick={() => set编辑中(null)}>放弃修改</次级按钮>
                          <span className="text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.7)' }}>
                            可用占位符：{'{{正文}}'} {'{{上下文}}'} {'{{世界书触发}}'} {'{{用户需求}}'}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="mt-1 max-h-20 overflow-auto text-[11px] leading-relaxed font-mono"
                        style={{ color: 'rgba(var(--tj-text-secondary), 0.85)' }}
                      >
                        {条目.content.slice(0, 400)}{条目.content.length > 400 ? '…' : ''}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </字段>
        ) : null}

        {主配置名 ? (
          <提示条 kind="info" text={`主 API 配置：${主配置名}。上面留空的字段都会回退到它。`} />
        ) : null}
        <提示条
          kind="info"
          text="导入格式兼容 st-chatu8 的 LLM 预设：一个含 entries 数组的 JSON，或 { 预设名: { entries: [...] } } 的映射。"
        />
      </面板>
    </div>
  );
}

/** 归一化条目：补齐缺省字段，保证运行期读到的结构完整。 */
function 归一化条目(原始: unknown, 下标: number): LLM条目 | null {
  if (!原始 || typeof 原始 !== 'object') return null;
  const 记录 = 原始 as Record<string, unknown>;
  const role = 记录.role === 'user' || 记录.role === 'assistant' ? 记录.role : 'system';
  const content = typeof 记录.content === 'string' ? 记录.content : '';
  if (!content.trim()) return null;
  return {
    id: typeof 记录.id === 'string' && 记录.id ? 记录.id : `导入_${下标}_${Math.random().toString(36).slice(2, 8)}`,
    name: typeof 记录.name === 'string' ? 记录.name : `条目 ${下标 + 1}`,
    role,
    content,
    enabled: 记录.enabled !== false,
    触发方式: 记录.触发方式 === 'keyword' || 记录.触发方式 === 'manual' ? 记录.触发方式 : 'always',
    触发词: Array.isArray(记录.触发词) ? 记录.触发词.map((项) => String(项)) : [],
    与触发: 记录.与触发 === true,
  };
}

/**
 * 把各种社区预设形状归一成 `{ 预设名: LLM 预设 }`。
 *
 * 社区导出的格式非常不统一，少认一种用户就会以为「导入没反应」。目前覆盖：
 *   ① **导出信封**：`{ type, version, exportedAt, data: {...} }`，真正的预设嵌在 `data` 里
 *      （实测的 `llm预设.json` 就是这种，条目在 `data.messages`）；
 *   ② 条目数组的键：`entries`（st-chatu8 原生）与 `messages`（聊天式预设）都认；
 *   ③ 单个预设对象、裸条目数组、整份预设表（值是 `{ entries }` 或裸数组）。
 */
export function 归一化导入(解析: unknown, 文件名 = '导入', 深度 = 0): Record<string, LLM预设> {
  const 建 = (entries: LLM条目[]): LLM预设 => ({
    entries,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const 收条目 = (值: unknown): LLM条目[] => (
    Array.isArray(值) ? 值.map(归一化条目).filter((项): 项 is LLM条目 => Boolean(项)) : []
  );
  const 条目键 = ['entries', 'messages', 'preset', 'items', 'prompts'] as const;

  // 防环：信封套信封理论上可以无限深，但超过几层一定是结构异常。
  if (深度 > 4) return {};

  // 形态一：直接是条目数组。
  if (Array.isArray(解析)) {
    const 条目 = 收条目(解析);
    return 条目.length > 0 ? { [文件名.replace(/\.json$/i, '')]: 建(条目) } : {};
  }
  if (!解析 || typeof 解析 !== 'object') return {};

  const 根 = 解析 as Record<string, unknown>;

  // 形态二：导出信封。只认 `data` —— 这是实际见到的键；
  // 往里递归一次，里面的形状交给后面的分支处理。
  if (根.data && typeof 根.data === 'object' && !Array.isArray(根.data)) {
    const 内层 = 归一化导入(根.data, 文件名, 深度 + 1);
    if (Object.keys(内层).length > 0) return 内层;
  }

  // 形态三：单个预设对象（条目挂在 entries / messages 等键上）。
  for (const 键 of 条目键) {
    if (!Array.isArray(根[键])) continue;
    const 条目 = 收条目(根[键]);
    if (条目.length === 0) continue;
    const 名称 = typeof 根.name === 'string' && 根.name.trim()
      ? 根.name.trim()
      : 文件名.replace(/\.json$/i, '');
    return { [名称]: 建(条目) };
  }

  // 形态四：预设表。值可能是 `{ entries }` / `{ messages }`，也可能是裸数组。
  const 结果: Record<string, LLM预设> = {};
  for (const [名称, 值] of Object.entries(根)) {
    let 原始条目: unknown;
    if (Array.isArray(值)) {
      原始条目 = 值;
    } else if (值 && typeof 值 === 'object') {
      const 记录 = 值 as Record<string, unknown>;
      for (const 键 of 条目键) {
        if (Array.isArray(记录[键])) { 原始条目 = 记录[键]; break; }
      }
      // 再往里一层：`{ 预设名: { data: { messages: [...] } } }` 也要认。
      if (!原始条目 && 记录.data && typeof 记录.data === 'object') {
        const 内层 = 归一化导入(记录.data, 名称, 深度 + 1);
        if (Object.keys(内层).length > 0) { 结果[名称] = Object.values(内层)[0]; continue; }
      }
    }
    const 条目 = 收条目(原始条目);
    if (条目.length > 0) 结果[名称] = 建(条目);
  }
  return 结果;
}
