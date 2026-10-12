import { useMemo, useState } from 'react';
import type { 角色卡, 角色部位字段, 文生图系统设置 } from '@/models/genSystem';
import { 创建默认角色AI设置, 角色部位字段名 } from '@/models/genSystem';
import type { API配置项 } from '@/models/settings';
import type { ConnectionTestConfig } from '@/hooks/useAiTools';
import { 人物生成默认提示词 } from '@/prompts/cot/characterFeaturePrompt';
import {
  面板,
  提示条,
  次级按钮,
  开关行,
  设置字段 as 字段,
  主按钮,
} from '@/components/features/Settings/settingsPrimitives';
import { LLM接口字段 } from './LlmEndpointFields';
import { 部位字段标签 } from './CharacterSettingsEditor';
import {
  合并生成字段,
  服装草稿转条目,
  type 生成角色特征结果,
  type 服装草稿,
} from '@/services/ai/imageGen/characterFeature';

/**
 * 一键生成角色特征。
 *
 * 上游对应 `character.html` 的四个按钮（L112-L126）：生成提示词 / 修改角色提示词 /
 * 角色数据 / 翻译。本面板只做其中最有用的一件事：**照「人物生成」提示词产出 14 个部位字段**。
 *
 * 生成结果不直接落卡：先摊成一张对照表，默认全选，用户可以去勾不想改的字段。
 * 原因是模型经常把已经写好的手写设定改坏，而角色卡是长期资产，改坏一次很难发现。
 */
export function CharacterAIPanel({
  设置,
  onPatch,
  当前角色,
  角色列表,
  on选择角色,
  写入角色,
  请求生成,
  候选配置,
  主API模型,
  主API地址,
  onFetchModels,
}: {
  设置: 文生图系统设置;
  onPatch: (部分: Partial<文生图系统设置>) => void;
  当前角色?: 角色卡;
  角色列表: 角色卡[];
  on选择角色: (id: string) => void;
  写入角色: (角色: 角色卡) => void;
  请求生成?: (参数: {
    系统: 文生图系统设置;
    要求: string;
    角色?: 角色卡;
    signal?: AbortSignal;
  }) => Promise<生成角色特征结果>;
  /** 角色 AI 覆盖与主 API 合并后的实际配置，供「测试连接并读取模型列表」使用。 */
  候选配置?: API配置项 | null;
  主API模型?: string;
  主API地址?: string;
  onFetchModels?: (config: ConnectionTestConfig) => Promise<string[]>;
}) {
  const [要求, set要求] = useState('');
  const [生成中, set生成中] = useState(false);
  const [结果, set结果] = useState<生成角色特征结果 | null>(null);
  const [错误, set错误] = useState('');
  const [勾选字段, set勾选字段] = useState<Set<keyof 角色部位字段>>(new Set());
  const [勾选服装, set勾选服装] = useState<Set<number>>(new Set());
  const [显示原始回复, set显示原始回复] = useState(false);
  const [追加服装, set追加服装] = useState(true);

  const 角色AI = 设置.角色AI;
  const 有要求 = 要求.trim().length > 0;
  // 没显式选卡时以第一张卡为目标：打开这个页签的人多半就是想给某张卡生成，
  // 让它落到一个空下拉会让人以为「必须先回去点一下」。
  const 目标角色 = 当前角色 ?? 角色列表[0];

  const 可应用字段 = useMemo(() => {
    if (!结果) return [] as Array<{ 键: keyof 角色部位字段; 新值: string; 旧值: string }>;
    return 角色部位字段名
      .filter((键) => (结果.字段[键] ?? '').trim().length > 0)
      .map((键) => ({
        键,
        新值: (结果.字段[键] ?? '').trim(),
        旧值: 目标角色 ? (目标角色[键] ?? '') : '',
      }));
  }, [结果, 目标角色]);

  const 跑生成 = async () => {
    if (!请求生成) {
      set错误('这个入口没有接上模型调用（例如在只读的设置预览里）。');
      return;
    }
    if (!有要求) {
      set错误('先写一句要求，例如角色的名字与身份，再点生成。');
      return;
    }
    set错误('');
    set结果(null);
    set生成中(true);
    try {
      const 生成结果 = await 请求生成({ 系统: 设置, 要求, 角色: 目标角色 });
      set结果(生成结果);
      const 字段键 = 角色部位字段名.filter((键) => (生成结果.字段[键] ?? '').trim().length > 0);
      set勾选字段(new Set(字段键));
      set勾选服装(new Set(生成结果.服装.map((_, 序号) => 序号)));
      if (字段键.length === 0) {
        set显示原始回复(true);
        set错误('模型没有给出可解析的 <人物> 区块，下面附上它的原始回复。');
      }
    } catch (异常) {
      set错误(异常 instanceof Error ? 异常.message : String(异常));
    } finally {
      set生成中(false);
    }
  };

  const 应用 = () => {
    if (!目标角色 || !结果) return;
    let 下一 = 合并生成字段(目标角色, 结果.字段, [...勾选字段]);
    if (追加服装) {
      const 新服装 = 结果.服装
        .filter((_, 序号) => 勾选服装.has(序号))
        .map((草稿: 服装草稿) => 服装草稿转条目(草稿));
      if (新服装.length > 0) {
        下一 = { ...下一, outfits: [...下一.outfits, ...新服装], updatedAt: Date.now() };
      }
    }
    写入角色(下一);
    set结果(null);
    set要求('');
  };

  const 切换字段 = (键: keyof 角色部位字段) => {
    const 下一 = new Set(勾选字段);
    if (下一.has(键)) 下一.delete(键); else 下一.add(键);
    set勾选字段(下一);
  };

  return (
    <div className="space-y-4">
      <面板
        title="一键生成角色特征"
        desc="用「人物生成」提示词让模型按格式产出 14 个部位字段，解析后先给你过一遍再写回角色卡。生成过程与出图无关，不会消耗生图额度。"
      >
        <字段 label="目标角色卡" hint="生成结果会写到这张卡上；没选就是列表里的第一张。">
          <select
            className="kaituo-input w-full px-2 py-1.5 text-xs"
            value={目标角色?.id ?? ''}
            onChange={(事件) => on选择角色(事件.target.value)}
          >
            <option value="">（还没有角色卡）</option>
            {角色列表.map((角色) => (
              <option key={角色.id} value={角色.id}>
                {[角色.nameCN, 角色.nameEN].filter(Boolean).join(' / ') || 角色.id}
              </option>
            ))}
          </select>
        </字段>

        <字段
          label="角色设定 / 要求"
          hint="写得越具体越好：名字、身份、年龄段、发色瞳色、服装风格、性格。已有的部位字段会自动一起发给模型作为参考。"
        >
          <textarea
            className="kaituo-input h-28 w-full px-2 py-1.5 text-xs leading-relaxed"
            value={要求}
            spellCheck={false}
            placeholder="例：流萤，星核猎手少女，银白长发，翠绿色眼睛，清冷但温柔；日常穿白色外套与黑色短裙。需要 SFW 与 NSFW 两套描述。"
            onChange={(事件) => set要求(事件.target.value)}
          />
        </字段>

        <div className="flex flex-wrap items-center gap-2">
          <次级按钮 disabled={生成中 || !请求生成 || !有要求} onClick={() => void 跑生成()}>
            {生成中 ? '生成中…' : '一键生成'}
          </次级按钮>
          <次级按钮 disabled={生成中} onClick={() => { set结果(null); set错误(''); }}>清空结果</次级按钮>
          <span className="text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.68)' }}>
            {请求生成 ? '接口：角色 AI 覆盖 → 文生图 LLM → 主 API。' : '（当前入口未接模型调用）'}
          </span>
        </div>

        {错误 ? <提示条 kind="error" text={错误} /> : null}

        {结果 && 可应用字段.length > 0 ? (
          <面板 title={`生成结果（${可应用字段.length} 个字段，默认全选）`} desc="取消勾选的字段保持角色卡上的原值；生成值为空的字段一律不写回。">
            <div className="space-y-2">
              {可应用字段.map(({ 键, 新值, 旧值 }) => (
                <label
                  key={键}
                  className="flex cursor-pointer items-start gap-2 px-2 py-2"
                  style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))' }}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={勾选字段.has(键)}
                    onChange={() => 切换字段(键)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-serif text-xs tracking-wider" style={{ color: 'rgb(var(--tj-accent-primary))' }}>
                      {部位字段标签[键]}
                    </span>
                    <span className="mt-0.5 block break-words font-mono text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-primary), 0.9)' }}>
                      {新值}
                    </span>
                    {旧值 ? (
                      <span className="mt-0.5 block break-words font-mono text-[11px] leading-relaxed line-through" style={{ color: 'rgba(var(--tj-text-secondary), 0.6)' }}>
                        {旧值}
                      </span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>

            {结果.服装.length > 0 ? (
              <div className="space-y-2">
                <开关行
                  label="同时写入生成的服装"
                  desc="模型给出了 <服装> 区块；关掉则只写角色字段。"
                  checked={追加服装}
                  onChange={set追加服装}
                />
                {追加服装 ? (
                  <div className="space-y-1">
                    {结果.服装.map((草稿, 序号) => (
                      <label
                        key={`${草稿.name}-${序号}`}
                        className="flex cursor-pointer items-center gap-2 px-2 py-1 text-[11px]"
                        style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))' }}
                      >
                        <input
                          type="checkbox"
                          checked={勾选服装.has(序号)}
                          onChange={() => {
                            const 下一 = new Set(勾选服装);
                            if (下一.has(序号)) 下一.delete(序号); else 下一.add(序号);
                            set勾选服装(下一);
                          }}
                        />
                        <span className="font-serif">{草稿.name || 草稿.英文名称 || '未命名服装'}</span>
                        <span className="min-w-0 flex-1 truncate font-mono" style={{ color: 'rgba(var(--tj-text-secondary), 0.8)' }}>
                          {[草稿.上半身, 草稿.下半身].filter(Boolean).join(' / ')}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {结果.未识别.length > 0 ? (
              <提示条
                kind="info"
                text={`模型输出了本应用不认识的字段名，已忽略：${结果.未识别.join('、')}`}
              />
            ) : null}

            <主按钮 onClick={应用} disabled={!目标角色 || 勾选字段.size === 0}>写入角色卡</主按钮>
          </面板>
        ) : null}

        {结果 ? (
          <div className="space-y-2">
            <次级按钮 onClick={() => set显示原始回复((值) => !值)}>
              {显示原始回复 ? '隐藏模型原始回复' : '查看模型原始回复'}
            </次级按钮>
            {显示原始回复 ? (
              <div className="kaituo-input max-h-64 overflow-auto whitespace-pre-wrap px-2 py-1.5 text-[11px] font-mono leading-relaxed">
                {结果.原始回复 || '（空回复）'}
              </div>
            ) : null}
          </div>
        ) : null}
      </面板>

      <面板
        title="角色 AI 设置"
        desc="提示词默认取用户的「人物生成」预设。接口留空时依次回退：文生图 LLM 预设 → 主 API。"
      >
        <字段 label="提示词" hint="这是 system 消息；本次要求与现有角色卡会作为 user 消息附在后面。">
          <textarea
            className="kaituo-input h-64 w-full px-2 py-1.5 text-xs leading-relaxed"
            value={角色AI.提示词}
            spellCheck={false}
            onChange={(事件) => onPatch({ 角色AI: { ...角色AI, 提示词: 事件.target.value } })}
          />
        </字段>
        <div className="flex flex-wrap gap-2">
          <次级按钮
            onClick={() => onPatch({ 角色AI: { ...角色AI, 提示词: 人物生成默认提示词 } })}
          >
            恢复「人物生成」默认提示词
          </次级按钮>
          <次级按钮
            onClick={() => onPatch({ 角色AI: { ...创建默认角色AI设置() } })}
          >
            恢复全部默认
          </次级按钮>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <字段 label="温度" hint="0.9 左右比较能给出多样的外貌描写；调低会让不同角色长得更像。">
            <input
              type="number"
              min={0}
              max={2}
              step={0.05}
              className="kaituo-input w-full px-2 py-1.5 text-sm"
              value={角色AI.温度}
              onChange={(事件) => {
                const 值 = Number(事件.target.value);
                onPatch({ 角色AI: { ...角色AI, 温度: Number.isFinite(值) ? Math.min(2, Math.max(0, 值)) : 0.9 } });
              }}
            />
          </字段>
          <字段 label="最大输出" hint="14 个字段都是 tag 串，给 8192 足够；太小会在半途被截断。">
            <input
              type="number"
              min={256}
              step={256}
              className="kaituo-input w-full px-2 py-1.5 text-sm"
              value={角色AI.最大输出}
              onChange={(事件) => {
                const 值 = Number(事件.target.value);
                onPatch({ 角色AI: { ...角色AI, 最大输出: Number.isFinite(值) ? Math.max(256, Math.trunc(值)) : 8192 } });
              }}
            />
          </字段>
        </div>

        <提示条
          kind="info"
          text={设置.LLM.启用
            ? '当前「文生图 LLM 预设」是启用状态，角色 AI 没填覆盖时会走它。'
            : '当前「文生图 LLM 预设」未启用；角色 AI 没填覆盖时会直接回退到主 API。'}
        />

        <LLM接口字段
          值={角色AI.API}
          onPatch={(部分) => onPatch({ 角色AI: { ...角色AI, API: { ...角色AI.API, ...部分 } } })}
          候选配置={候选配置}
          主配置={{ model: 主API模型, baseUrl: 主API地址 }}
          onFetchModels={onFetchModels}
          名称="角色 AI"
        />
      </面板>
    </div>
  );
}
