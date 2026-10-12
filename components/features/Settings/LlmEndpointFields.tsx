import { useState } from 'react';
import type { API配置项 } from '@/models/settings';
import type { ConnectionTestConfig } from '@/hooks/useAiTools';
import { 提示条, 次级按钮, 设置字段 as 字段 } from '@/components/features/Settings/settingsPrimitives';
import { providerOptions } from './settingsShared';

export interface 接口覆盖值 {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * 「接口 + 模型」字段组。
 *
 * 为什么抽出来：文生图的 LLM 预设与角色 AI 原先都只有四个手填输入框，
 * 没有「先连上、再从列表里选模型」这一步——而其他每一条模型链路
 * （新闻/手机/记忆/忆馆/剧情编织……）都有。同一件事写两遍必然会漂移，
 * 所以这里做成共用件，两个面板都用它。
 *
 * 取值语义与主 API 的字段级合并保持一致：留空的字段回退主 API，
 * 因此「读取模型列表」用的是**合并后**的配置（`候选配置` 由调用方算好）。
 */
export function LLM接口字段({
  值,
  onPatch,
  候选配置,
  主配置,
  onFetchModels,
  名称 = '接口',
}: {
  值: 接口覆盖值;
  onPatch: (部分: Partial<接口覆盖值>) => void;
  /** 覆盖字段与主 API 合并后的实际配置；为空表示连地址都还取不到。 */
  候选配置?: API配置项 | null;
  /** 主 API 的名称/模型/地址，用于提示「留空会用到什么」。 */
  主配置?: { name?: string; model?: string; baseUrl?: string } | null;
  /** 读取模型列表；未注入时按钮不出现（例如只读的设置预览）。 */
  onFetchModels?: (config: ConnectionTestConfig) => Promise<string[]>;
  /** 出错文案里的名字，例如「文生图 LLM」「角色 AI」。 */
  名称?: string;
}) {
  const [载入中, set载入中] = useState(false);
  const [模型列表, set模型列表] = useState<string[]>([]);
  const [提示, set提示] = useState<{ kind: 'info' | 'ok' | 'error'; text: string } | null>(null);

  const 读取模型 = async () => {
    if (!onFetchModels) return;
    if (!候选配置 || !候选配置.baseUrl.trim()) {
      set提示({
        kind: 'error',
        text: '还没有可用的接口地址：在这里填地址，或先到「API 接口」页配置主 API。',
      });
      return;
    }
    if (!候选配置.apiKey.trim()) {
      set提示({
        kind: 'error',
        text: '这个接口需要 API Key：在这里填，或先到「API 接口」页把主 API 的 Key 配好。',
      });
      return;
    }
    set载入中(true);
    set提示({ kind: 'info', text: '正在连接并读取模型列表…' });
    try {
      const 列表 = await onFetchModels(候选配置);
      set模型列表(列表);
      set提示(
        列表.length > 0
          ? { kind: 'ok', text: `连接成功，读到 ${列表.length} 个模型，从下面的列表里选一个。` }
          : { kind: 'info', text: '连接成功，但这个接口没有返回任何模型；手填模型 ID 也可以。' },
      );
    } catch (错误) {
      set提示({ kind: 'error', text: `${名称}读取模型失败：${错误 instanceof Error ? 错误.message : String(错误)}` });
    } finally {
      set载入中(false);
    }
  };

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <字段 label="接口类型" hint="留空即回退到主 API 的接口类型。">
        <select
          className="kaituo-input w-full px-3 py-2 text-sm"
          value={值.provider}
          onChange={(事件) => onPatch({ provider: 事件.target.value })}
        >
          <option value="">留空回退主 API</option>
          {providerOptions.map((项) => (
            <option key={项.value} value={项.value}>{项.label}</option>
          ))}
        </select>
      </字段>

      <字段
        label="接口地址"
        hint={主配置?.baseUrl ? `留空回退主 API（${主配置.baseUrl}）。` : '留空回退主 API 的地址。'}
      >
        <input
          className="kaituo-input w-full px-3 py-2 text-sm font-mono"
          value={值.baseUrl}
          placeholder={主配置?.baseUrl || 'https://api.openai.com/v1'}
          onChange={(事件) => onPatch({ baseUrl: 事件.target.value })}
        />
      </字段>

      <字段 label="API Key" hint="留空回退主 API 的 Key。">
        <input
          type="password"
          className="kaituo-input w-full px-3 py-2 text-sm font-mono"
          value={值.apiKey}
          placeholder="留空回退主 API"
          onChange={(事件) => onPatch({ apiKey: 事件.target.value })}
        />
      </字段>

      <字段
        label="模型"
        hint={主配置?.model
          ? `留空回退主 API 的模型（${主配置.model}）；也可以先「测试连接并读取模型列表」再选。`
          : '留空回退主 API 的模型；主 API 未配模型时必须在这里填。'}
      >
        <div className="flex gap-1.5">
          <input
            className="kaituo-input min-w-0 flex-1 px-3 py-2 text-sm font-mono"
            value={值.model}
            placeholder={主配置?.model || '例如 gpt-4o-mini'}
            onChange={(事件) => onPatch({ model: 事件.target.value })}
          />
          {onFetchModels ? (
            <次级按钮 disabled={载入中} onClick={() => void 读取模型()}>
              {载入中 ? '连接中…' : '测试连接并读取模型'}
            </次级按钮>
          ) : null}
        </div>
        {模型列表.length > 0 ? (
          <select
            className="kaituo-input mt-1.5 w-full px-2.5 py-1.5 text-xs"
            value=""
            onChange={(事件) => {
              if (事件.target.value) onPatch({ model: 事件.target.value });
            }}
          >
            <option value="">从列表选择（{模型列表.length} 个）</option>
            {模型列表.map((项) => (
              <option key={项} value={项}>{项}</option>
            ))}
          </select>
        ) : null}
        {提示 ? <提示条 kind={提示.kind} text={提示.text} /> : null}
      </字段>
    </div>
  );
}
