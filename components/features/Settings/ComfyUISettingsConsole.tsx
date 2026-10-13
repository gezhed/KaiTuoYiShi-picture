import { useEffect, useMemo, useState } from 'react';
import type { ComfyUI档案, 游戏设置 } from '@/models/settings';
import type { Comfy可选资源 } from '@/services/ai/imageGen/comfyClient';
import { 未选择模型 } from '@/services/ai/imageGen/comfyEngine';
import { 是ComfyUI界面格式 } from '@/services/ai/imageGen/types';
import {
  主按钮,
  面板,
  提示条,
  次级按钮,
  开关行,
  页签条,
  设置字段 as 字段,
} from './settingsPrimitives';
import { CharacterSettingsPanel } from './CharacterSettingsPanel';
import { TagVocabularyPanel } from './TagVocabularyPanel';
import { 预告参考图 } from '@/services/ai/imageGen/referenceImage';
import { NovelAI模型目录 } from '@/services/ai/imageGen/novelaiClient';
import { 读取SD资源列表, type SD可选资源 } from '@/services/ai/imageGen/sdClient';
import { Banana编辑端点, Banana生成端点, Banana模型列表 } from '@/services/ai/imageGen/bananaClient';
import { PromptPreviewPanel } from './PromptPreviewPanel';
import { SelfCheckPanel } from './SelfCheckPanel';
import { LlmSettingsPanel } from './LlmSettingsPanel';
import { FixedStylePanel } from './FixedStylePanel';
import { Banana尺寸列表, NovelAI采样器列表, NovelAI噪点表列表, SD放大算法列表 } from '@/models/genSystem';
import { 建候选配置 } from '@/services/ai/imageGen/llmConfig';
import { cardClip } from '@/components/ui/clipPaths';

export type Comfy页签 = 'overview' | 'connection' | 'workflow' | 'novelai' | 'sd' | 'banana' | 'converter' | 'prompt' | 'character' | 'vocabulary' | 'cache';

interface Props {
  settings: 游戏设置;
  onChange: (next: 游戏设置) => void;
  /** 勿直连 saveSetting。 */
  onPersistSettings: (next: 游戏设置) => Promise<void>;
  /** 测试 ComfyUI 是否可达；返回可读结果，失败抛错。 */
  onTestConnection: (地址: string) => Promise<string>;
  /** 拉取 /object_info 得到可选模型/采样器等；失败抛错。 */
  onFetchResources: (地址: string) => Promise<Comfy可选资源>;
  /** 图片缓存统计与清理。 */
  onCacheStats: () => Promise<{ 条目数: number; 图片数: number; 总字节: number }>;
  onClearCache: () => Promise<void>;
  /** 主 API 信息，只用于LLM面板上提示「留空会回退到什么」。 */
  主API名?: string;
  主API模型?: string;
  主API地址?: string;
  /** 设备设置里的 API 列表，供「测试连接并读取模型列表」合并覆盖字段。 */
  apiSettings?: import('@/models/settings').API设置;
  /** 读取模型列表；不接时两个接口面板不显示该按钮。 */
  onFetchModels?: (config: import('@/hooks/useAiTools').ConnectionTestConfig) => Promise<string[]>;
  /** 一键生成角色特征的模型调用；不接时「生成」页签会禁用按钮。 */
  生成角色特征?: (参数: {
    系统: import('@/models/genSystem').文生图系统设置;
    要求: string;
    角色?: import('@/models/genSystem').角色卡;
    signal?: AbortSignal;
  }) => Promise<import('@/services/ai/imageGen/characterFeature').生成角色特征结果>;
}

const 页签: Array<{ id: Comfy页签; label: string; desc: string }> = [
  { id: 'overview', label: '总览', desc: '开关与渠道' },
  { id: 'connection', label: 'ComfyUI', desc: '地址与并发' },
  { id: 'workflow', label: '工作流', desc: 'API 格式 JSON' },
  { id: 'novelai', label: 'NovelAI', desc: '模型与坐标' },
  { id: 'sd', label: 'SD WebUI', desc: 'A1111 / Forge' },
  { id: 'banana', label: 'Banana / Grok', desc: 'OpenAI 兼容图像接口' },
  { id: 'converter', label: 'LLM 预设', desc: '正文 → 插图提示词' },
  { id: 'prompt', label: '提示词', desc: '预设与替换规则' },
  { id: 'character', label: '角色管理', desc: '角色卡与部位字段' },
  { id: 'vocabulary', label: '词库与标签', desc: '导入 tagData 与选词' },
  { id: 'cache', label: '图片缓存', desc: '容量与清理' },
];

function 格式化字节(字节: number): string {
  if (字节 < 1024) return `${字节} B`;
  if (字节 < 1024 * 1024) return `${(字节 / 1024).toFixed(1)} KB`;
  return `${(字节 / 1024 / 1024).toFixed(1)} MB`;
}

export function ComfyUISettingsConsole({
  settings,
  onChange,
  onPersistSettings,
  onTestConnection,
  onFetchResources,
  onCacheStats,
  onClearCache,
  主API名,
  主API模型,
  主API地址,
  apiSettings,
  onFetchModels,
  生成角色特征,
}: Props) {
  const [当前页, set当前页] = useState<Comfy页签>('overview');
  const [保存提示, set保存提示] = useState<{ kind: 'info' | 'ok' | 'error'; text: string } | null>(null);
  const [测试提示, set测试提示] = useState<{ kind: 'info' | 'ok' | 'error'; text: string } | null>(null);
  const [测试中, set测试中] = useState(false);
  const [资源, set资源] = useState<Comfy可选资源 | null>(null);
  const [缓存信息, set缓存信息] = useState<{ 条目数: number; 图片数: number; 总字节: number } | null>(null);
  // 词库面板与角色面板跨页签协作：追加串只在离开角色页后才送达，因此状态挂在控制台上。
  const [待追加标签, set待追加标签] = useState('');
  const [追加序号, set追加序号] = useState(0);
  const [追加目标, set追加目标] = useState('角色特征');
  const [sd资源, setSd资源] = useState<SD可选资源 | null>(null);
  const [sd提示, setSd提示] = useState<{ kind: 'info' | 'ok' | 'error'; text: string } | null>(null);
  // 改动后是否还没落到本机。不是精确的脏值比对，只用来提醒「别忘了点保存」。
  const [有未保存, set有未保存] = useState(false);

  const 系统 = settings.文生图系统;
  const 档案 = 系统.comfyui.档案列表[系统.comfyui.当前档案];
  const 预告 = 预告参考图(系统);
  const 角色上下文 = useMemo(
    () => ({ 启用列表: 系统.角色启用列表, 全部角色: 系统.角色卡 }),
    [系统.角色启用列表, 系统.角色卡],
  );
  // 「测试连接并读取模型列表」用的合并配置：覆盖字段留空时回退主 API，
  // 所以这里每次渲染都按当前草稿重算，用户改完地址就能直接点。
  const LLM候选配置 = useMemo(
    () => (apiSettings ? 建候选配置(settings, apiSettings, 系统.LLM.API, '__image_illustration_converter__', '文生图LLM') : null),
    [settings, apiSettings, 系统.LLM.API],
  );
  const 角色AI候选配置 = useMemo(
    () => (apiSettings ? 建候选配置(settings, apiSettings, 系统.角色AI.API, '__character_ai__', '角色AI') : null),
    [settings, apiSettings, 系统.角色AI.API],
  );

  const 补丁系统 = (补丁: Partial<typeof 系统>) => {
    set有未保存(true);
    onChange({ ...settings, 文生图系统: { ...系统, ...补丁 } });
  };
  const 补丁comfyui = (补丁: Partial<typeof 系统.comfyui>) => {
    补丁系统({ comfyui: { ...系统.comfyui, ...补丁 } });
  };
  const 补丁档案 = (补丁: Partial<ComfyUI档案>) => {
    if (!档案) return;
    补丁comfyui({ 档案列表: { ...系统.comfyui.档案列表, [系统.comfyui.当前档案]: { ...档案, ...补丁 } } });
  };
  const 补丁连接 = (补丁: Partial<ComfyUI档案['连接']>) => {
    if (!档案) return;
    补丁档案({ 连接: { ...档案.连接, ...补丁 } });
  };
  const 补丁参数 = (补丁: Partial<ComfyUI档案['参数']>) => {
    if (!档案) return;
    补丁档案({ 参数: { ...档案.参数, ...补丁 } });
  };
  const 补丁novelai = (补丁: Partial<typeof 系统.novelai>) => {
    补丁系统({ novelai: { ...系统.novelai, ...补丁 } });
  };
  const 补丁sd = (补丁: Partial<typeof 系统.sd>) => {
    补丁系统({ sd: { ...系统.sd, ...补丁 } });
  };
  const 补丁banana = (补丁: Partial<typeof 系统.banana>) => {
    补丁系统({ banana: { ...系统.banana, ...补丁 } });
  };

  const 处理测试Sd = async () => {
    set测试中(true);
    setSd提示({ kind: 'info', text: '正在读取 SD WebUI 资源列表…' });
    try {
      const 结果 = await 读取SD资源列表(系统.sd);
      setSd资源(结果);
      setSd提示({
        kind: 'ok',
        text: `已读取：模型 ${结果.模型.length}、采样器 ${结果.采样器.length}、VAE ${结果.VAE.length}、调度器 ${结果.调度器.length}。`,
      });
      if (结果.采样器.length > 0 && !结果.采样器.includes(系统.sd.采样器)) {
        setSd提示({ kind: 'ok', text: `已读取资源列表。当前采样器「${系统.sd.采样器}」不在服务端列表里，可能不被识别。` });
      }
    } catch (错误) {
      setSd提示({ kind: 'error', text: `读取失败：${错误 instanceof Error ? 错误.message : String(错误)}` });
    } finally {
      set测试中(false);
    }
  };

  const 处理保存 = async () => {
    set保存提示(null);
    try {
      await onPersistSettings(settings);
      set有未保存(false);
      set保存提示({ kind: 'ok', text: '文生图设置已保存。' });
    } catch (错误) {
      set保存提示({ kind: 'error', text: `保存失败：${错误 instanceof Error ? 错误.message : String(错误)}` });
    }
  };

  const 处理测试 = async () => {
    set测试中(true);
    set测试提示({ kind: 'info', text: '正在连接 ComfyUI…' });
    try {
      const 文本 = await onTestConnection(档案?.连接.地址 ?? '');
      set测试提示({ kind: 'ok', text: 文本 });
    } catch (错误) {
      set测试提示({ kind: 'error', text: `连接失败：${错误 instanceof Error ? 错误.message : String(错误)}` });
    } finally {
      set测试中(false);
    }
  };

  const 处理拉取资源 = async () => {
    set测试中(true);
    set测试提示({ kind: 'info', text: '正在读取 ComfyUI 资源列表…' });
    try {
      const 结果 = await onFetchResources(档案?.连接.地址 ?? '');
      set资源(结果);
      set测试提示({
        kind: 'ok',
        text: `已读取：模型 ${结果.模型.length}、采样器 ${结果.采样器.length}、`
          + `LoRA ${结果.lora.length}、VAE ${结果.vae.length}。`
          + (结果.lora.length > 0 ? '角色卡里可以直接从下拉里挑 LoRA。' : ''),
      });
    } catch (错误) {
      set测试提示({ kind: 'error', text: `读取失败：${错误 instanceof Error ? 错误.message : String(错误)}` });
    } finally {
      set测试中(false);
    }
  };

  const 处理缓存统计 = async () => {
    try {
      set缓存信息(await onCacheStats());
    } catch (错误) {
      set保存提示({ kind: 'error', text: `读取缓存失败：${错误 instanceof Error ? 错误.message : String(错误)}` });
    }
  };

  // 进「图片缓存」页就先读一次容量：不点按钮时页面一片空白，很容易被当成「缓存坏了」。
  useEffect(() => {
    if (当前页 !== 'cache') return;
    void 处理缓存统计();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [当前页]);

  const 工作流提示 = (() => {
    const 文本 = 档案?.工作流Json?.trim() ?? '';
    if (!文本) return { kind: 'info' as const, text: '尚未导入工作流。请在 ComfyUI 里用「Save (API Format)」导出后粘贴到下面。' };
    if (是ComfyUI界面格式((() => { try { return JSON.parse(文本) as unknown; } catch { return null; } })())) {
      return {
        kind: 'error' as const,
        text: '检测到 UI 格式工作流（含 nodes/links）。chatu8 不支持自动转换，请在 ComfyUI 里改用「Save (API Format)」重新导出。',
      };
    }
    return null;
  })();

  return (
    <div className="space-y-5">
      <div
        className="px-4 py-4"
        style={{
          border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))',
          clipPath: cardClip,
        }}
      >
        <div className="font-serif text-lg font-bold tracking-[0.24em]" style={{ color: 'rgb(var(--tj-ui-title))' }}>
          ComfyUI 文生图
        </div>
        <div className="mt-2 max-w-3xl text-sm leading-relaxed" style={{ color: 'rgba(var(--tj-ui-body), 0.82)' }}>
          工作流用「占位符」驱动参数：在 ComfyUI 导出的 API 格式 JSON 里，把要控制的输入值改成
          <code className="mx-1">"seed"</code>、<code className="mx-1">"steps"</code>、<code className="mx-1">"prompt"</code>
          这类占位符（<strong>必须带双引号</strong>），出图时按名替换。节点怎么连不影响取参，所以任意工作流都能用。
        </div>
      </div>

      <页签条 页签={页签} 当前={当前页} onSelect={set当前页} />

      {当前页 === 'overview' && (
        <div className="space-y-4">
          <面板 title="基础开关">
            <字段 label="生图渠道" hint="各渠道的设置独立保存，切换不会丢配置。">
              <select
                className="kaituo-input w-full px-3 py-2 text-sm"
                value={系统.渠道}
                onChange={(事件) => 补丁系统({ 渠道: 事件.target.value as typeof 系统.渠道 })}
              >
                <option value="comfyui">ComfyUI</option>
                <option value="novelai">NovelAI</option>
                <option value="sd">SD WebUI（A1111 / Forge）</option>
                <option value="banana">Banana / Grok（OpenAI 兼容）</option>
                <option value="runninghub" disabled>RunningHub（未接入）</option>
              </select>
            </字段>
            <开关行
              label="启用文生图"
              desc="关闭后不产生任何请求；已生成的图片与缓存保留。"
              checked={系统.启用}
              onChange={(值) => 补丁系统({ 启用: 值 })}
            />
            <开关行
              label="启用正文配图"
              desc="开启后可按正文自动生成插图；每轮图数由下方上限或模型输出决定。"
              checked={系统.正文配图.启用}
              onChange={(值) => 补丁系统({ 正文配图: { ...系统.正文配图, 启用: 值 } })}
            />
            <开关行
              label="默认显示文生图"
              desc="关闭后正文里不再显示已生成的插图，只保留手动生成入口；图片本身仍留在相册与缓存里。"
              checked={系统.正文配图.默认显示}
              onChange={(值) => 补丁系统({ 正文配图: { ...系统.正文配图, 默认显示: 值 } })}
            />
            <开关行
              label="默认展开文生图"
              desc="开启后插图直接铺开显示大图；关闭时正文里只占一行，点标题才展开。"
              checked={系统.正文配图.默认展开}
              onChange={(值) => 补丁系统({ 正文配图: { ...系统.正文配图, 默认展开: 值 } })}
            />
            <开关行
              label="AI 自主分辨率"
              desc="允许模型在提示词里写 960x1280 之类的尺寸，逐图覆盖全局分辨率。"
              checked={系统.comfyui.自主分辨率}
              onChange={(值) => 补丁comfyui({ 自主分辨率: 值 })}
            />
            <开关行
              label="写入图片缓存"
              desc="按提示词归档成有序图廊；同一提示词的多次生成会累积而不是覆盖。"
              checked={系统.图片缓存.启用}
              onChange={(值) => 补丁系统({ 图片缓存: { ...系统.图片缓存, 启用: 值 } })}
            />
          </面板>

          <面板 title="正文配图" desc="触发时机与每轮图数。图数最终由模型输出的 image 块条数决定，上限只是封顶。">
            <div className="grid gap-3 md:grid-cols-2">
              <字段 label="触发方式">
                <select
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={系统.正文配图.模式}
                  onChange={(事件) => 补丁系统({
                    正文配图: { ...系统.正文配图, 模式: 事件.target.value === 'auto' ? 'auto' : 'manual' },
                  })}
                >
                  <option value="manual">手动（正文出现按钮）</option>
                  <option value="auto">自动（正文落地后生成）</option>
                </select>
              </字段>
              <字段 label="每轮上限" hint="0 表示不限制。">
                <input
                  type="number"
                  min={0}
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={系统.正文配图.每轮上限}
                  onChange={(事件) => 补丁系统({
                    正文配图: { ...系统.正文配图, 每轮上限: Math.max(0, Number(事件.target.value) || 0) },
                  })}
                />
              </字段>
            </div>
          </面板>

          <面板 title="参考图" desc="参考图会被上传一次，再由 %comfyuicankaotupian% 占位符写进工作流。">
            <开关行
              label="启用参考图上传"
              desc="从角色卡的媒体里按「勾选的照片 → 参考用途 → 第一张图片」的顺序取一张。"
              checked={系统.comfyui.参考图上传}
              onChange={(值) => 补丁comfyui({ 参考图上传: 值 })}
            />
            <提示条 kind={预告.available ? 'ok' : 'info'} text={预告.说明} />
          </面板>
        </div>
      )}

      {当前页 === 'connection' && 档案 && (
        <div className="space-y-4">
          <面板 title="连接" desc="浏览器直连，需要 ComfyUI 允许跨域（本插件不发送任何鉴权头）。">
            <字段 label="ComfyUI 地址">
              <input
                className="kaituo-input w-full px-3 py-2 text-sm font-mono"
                value={档案.连接.地址}
                placeholder="http://localhost:8188"
                onChange={(事件) => 补丁连接({ 地址: 事件.target.value })}
              />
            </字段>
            <div className="grid gap-3 md:grid-cols-2">
              <字段 label="最大并发" hint="1–10，与来源一致。本地机器建议 1–2。">
                <input
                  type="number"
                  min={1}
                  max={10}
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={档案.连接.最大并发}
                  onChange={(事件) => 补丁连接({ 最大并发: Math.max(1, Math.min(10, Number(事件.target.value) || 1)) })}
                />
              </字段>
              <字段 label="超时（秒）" hint="来源默认 1800。">
                <input
                  type="number"
                  min={10}
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={档案.连接.超时秒数}
                  onChange={(事件) => 补丁连接({ 超时秒数: Math.max(10, Number(事件.target.value) || 1800) })}
                />
              </字段>
            </div>
            <div className="flex flex-wrap gap-2">
              <次级按钮 onClick={() => void 处理测试()} disabled={测试中}>测试连接</次级按钮>
              <次级按钮 onClick={() => void 处理拉取资源()} disabled={测试中}>读取模型列表</次级按钮>
            </div>
            {测试提示 ? <提示条 kind={测试提示.kind} text={测试提示.text} /> : null}
          </面板>

          <面板 title="生成参数" desc="写入工作流里对应占位符的值。">
            <div className="grid gap-3 md:grid-cols-2">
              <字段 label="模型" hint={资源 ? undefined : '点「读取模型列表」后可选；也可手填。'}>
                {资源 && 资源.模型.length > 0 ? (
                  <select
                    className="kaituo-input w-full px-3 py-2 text-sm"
                    value={档案.参数.模型}
                    onChange={(事件) => 补丁参数({ 模型: 事件.target.value })}
                  >
                    <option value={未选择模型}>{未选择模型}</option>
                    {资源.模型.map((项) => <option key={项} value={项}>{项}</option>)}
                  </select>
                ) : (
                  <input
                    className="kaituo-input w-full px-3 py-2 text-sm font-mono"
                    value={档案.参数.模型}
                    placeholder={未选择模型}
                    onChange={(事件) => 补丁参数({ 模型: 事件.target.value })}
                  />
                )}
              </字段>
              <字段 label="采样器">
                {资源 && 资源.采样器.length > 0 ? (
                  <select
                    className="kaituo-input w-full px-3 py-2 text-sm"
                    value={档案.参数.采样器}
                    onChange={(事件) => 补丁参数({ 采样器: 事件.target.value })}
                  >
                    <option value={未选择模型}>{未选择模型}</option>
                    {资源.采样器.map((项) => <option key={项} value={项}>{项}</option>)}
                  </select>
                ) : (
                  <input
                    className="kaituo-input w-full px-3 py-2 text-sm font-mono"
                    value={档案.参数.采样器}
                    onChange={(事件) => 补丁参数({ 采样器: 事件.target.value })}
                  />
                )}
              </字段>
              <字段 label="调度器">
                <input
                  className="kaituo-input w-full px-3 py-2 text-sm font-mono"
                  value={档案.参数.调度器}
                  onChange={(事件) => 补丁参数({ 调度器: 事件.target.value })}
                />
              </字段>
              <字段 label="VAE">
                <input
                  className="kaituo-input w-full px-3 py-2 text-sm font-mono"
                  value={档案.参数.vae}
                  onChange={(事件) => 补丁参数({ vae: 事件.target.value })}
                />
              </字段>
              <字段 label="宽度">
                <input
                  type="number"
                  min={64}
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={档案.参数.宽度}
                  onChange={(事件) => 补丁参数({ 宽度: Math.max(64, Number(事件.target.value) || 1024) })}
                />
              </字段>
              <字段 label="高度">
                <input
                  type="number"
                  min={64}
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={档案.参数.高度}
                  onChange={(事件) => 补丁参数({ 高度: Math.max(64, Number(事件.target.value) || 1024) })}
                />
              </字段>
              <字段 label="步数">
                <input
                  type="number"
                  min={1}
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={档案.参数.步数}
                  onChange={(事件) => 补丁参数({ 步数: Math.max(1, Number(事件.target.value) || 28) })}
                />
              </字段>
              <字段 label="CFG">
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={档案.参数.cfg}
                  onChange={(事件) => 补丁参数({ cfg: Number(事件.target.value) || 0 })}
                />
              </字段>
              <字段 label="种子" hint="0 或 -1 表示每次随机。">
                <input
                  type="number"
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={档案.参数.种子}
                  onChange={(事件) => 补丁参数({ 种子: Number(事件.target.value) || 0 })}
                />
              </字段>
            </div>
          </面板>
        </div>
      )}

      {当前页 === 'workflow' && 档案 && (
        <面板 title="工作流 JSON（API 格式）" desc='粘贴 ComfyUI 的 Save (API Format) 导出内容。占位符必须写成 "seed" 这样带双引号的形式。'>
          {工作流提示 ? <提示条 kind={工作流提示.kind} text={工作流提示.text} /> : null}
          <textarea
            className="kaituo-input h-72 w-full px-3 py-2 text-xs font-mono leading-relaxed"
            value={档案.工作流Json}
            spellCheck={false}
            placeholder={'{\n  "3": {\n    "class_type": "KSampler",\n    "inputs": { "seed": "%seed%", "steps": "%steps%", "cfg": "%cfg_scale%" }\n  }\n}'}
            onChange={(事件) => 补丁档案({ 工作流Json: 事件.target.value })}
          />
        </面板>
      )}

      {当前页 === 'novelai' && (
        <div className="space-y-4">
          <面板 title="连接" desc="官方站点固定为 image.novelai.net；第三方站点会同时尝试「地址 + /ai/generate-image」与裸地址。">
            <字段 label="NovelAI 地址">
              <input
                className="kaituo-input w-full px-3 py-2 text-sm font-mono"
                value={系统.novelai.地址}
                placeholder="https://image.novelai.net"
                onChange={(事件) => 补丁novelai({ 地址: 事件.target.value })}
              />
            </字段>
            <字段 label="Token" hint="持久化 Token，保存在本地设备设置里。">
              <input
                type="password"
                className="kaituo-input w-full px-3 py-2 text-sm font-mono"
                value={系统.novelai.Token}
                onChange={(事件) => 补丁novelai({ Token: 事件.target.value })}
              />
            </字段>
            <字段 label="模型" hint="v5 系列用 params_version 4；v4/v5 才发分角色载荷。">
              <select
                className="kaituo-input w-full px-3 py-2 text-sm"
                value={系统.novelai.模型}
                onChange={(事件) => 补丁novelai({ 模型: 事件.target.value })}
              >
                {NovelAI模型目录.map((项) => <option key={项} value={项}>{项}</option>)}
              </select>
            </字段>
          </面板>

          <面板 title="生成参数">
            <div className="grid gap-3 md:grid-cols-2">
              <字段 label="宽度">
                <input
                  type="number"
                  min={64}
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={系统.novelai.宽度}
                  onChange={(事件) => 补丁novelai({ 宽度: Math.max(64, Number(事件.target.value) || 1024) })}
                />
              </字段>
              <字段 label="高度">
                <input
                  type="number"
                  min={64}
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={系统.novelai.高度}
                  onChange={(事件) => 补丁novelai({ 高度: Math.max(64, Number(事件.target.value) || 1024) })}
                />
              </字段>
              <字段 label="步数">
                <input
                  type="number"
                  min={1}
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={系统.novelai.步数}
                  onChange={(事件) => 补丁novelai({ 步数: Math.max(1, Number(事件.target.value) || 28) })}
                />
              </字段>
              <字段 label="提示词关联性 (scale)">
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={系统.novelai.关联性}
                  onChange={(事件) => 补丁novelai({ 关联性: Number(事件.target.value) || 0 })}
                />
              </字段>
              <字段 label="采样器">
                <select
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={系统.novelai.采样器}
                  onChange={(事件) => 补丁novelai({ 采样器: 事件.target.value })}
                >
                  {NovelAI采样器列表.map((项) => <option key={项} value={项}>{项}</option>)}
                </select>
              </字段>
              <字段 label="噪点表 (noise_schedule)">
                <select
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={系统.novelai.噪点表}
                  onChange={(事件) => 补丁novelai({ 噪点表: 事件.target.value })}
                >
                  {NovelAI噪点表列表.map((项) => <option key={项} value={项}>{项}</option>)}
                </select>
              </字段>
              <字段 label="种子" hint="0 或 -1 表示每次随机。">
                <input
                  type="number"
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={系统.novelai.种子}
                  onChange={(事件) => 补丁novelai({ 种子: Number(事件.target.value) || 0 })}
                />
              </字段>
              <字段 label="CFG Rescale" hint="上游默认 0.18，推荐 0.15~0.3。">
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={系统.novelai.cfgRescale}
                  onChange={(事件) => 补丁novelai({ cfgRescale: Number(事件.target.value) || 0 })}
                />
              </字段>
            </div>
          </面板>

          <面板 title="高级开关" desc="与上游字段一一对应。">
            <开关行
              label="动态阈值 (Decrisper)"
              desc="上游字段 dynamic_thresholding（nai3Deceisp）。"
              checked={系统.novelai.动态阈值}
              onChange={(值) => 补丁novelai({ 动态阈值: 值 })}
            />
            <开关行
              label="多样性增强 (Variety)"
              desc="关闭时 skip_cfg_above_sigma 发 null，与上游一致。"
              checked={系统.novelai.多样性增强}
              onChange={(值) => 补丁novelai({ 多样性增强: 值 })}
            />
            <开关行
              label="SMEA"
              desc="sm。开启后才可能启用 SMEA DYN。"
              checked={系统.novelai.sm}
              onChange={(值) => 补丁novelai({ sm: 值, sm_dyn: 值 ? 系统.novelai.sm_dyn : false })}
            />
            <开关行
              label="SMEA DYN"
              desc="sm_dyn。SMEA 关闭时会被强制为 false。"
              checked={系统.novelai.sm_dyn}
              disabled={!系统.novelai.sm}
              onChange={(值) => 补丁novelai({ sm_dyn: 值 })}
            />
            <开关行
              label="AI 默认角色位置"
              desc="开启时忽略提示词里解析出的坐标（上游 AI_use_coords）。"
              checked={系统.novelai.AI默认位置}
              onChange={(值) => 补丁novelai({ AI默认位置: 值 })}
            />
            <开关行
              label="参考强度归一化"
              desc="开启后，4.5 full/curated 模型反而交给 NAI 自己归一化；其余模型始终按总和分摊。"
              checked={系统.novelai.参考强度归一化}
              onChange={(值) => 补丁novelai({ 参考强度归一化: 值 })}
            />
            <字段 label="参考图信息提取" hint="0..1。参考图携带多少「信息」进入生成。">
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                className="kaituo-input w-full px-3 py-2 text-sm"
                value={系统.novelai.信息提取}
                onChange={(事件) => 补丁novelai({
                  信息提取: Math.min(1, Math.max(0, Number(事件.target.value))),
                })}
              />
            </字段>
            <提示条
              kind="info"
              text="参考图在「角色管理 → NovelAI 参考组」里配置，每组最多 4 张并各带强度与类型。"
            />
          </面板>
        </div>
      )}

      {当前页 === 'sd' && (
        <div className="space-y-4">
          <面板 title="连接" desc="A1111 / Forge 的地址。填了「认证」会发 Basic 头，留空则不发。">
            <字段 label="SD WebUI 地址">
              <input
                className="kaituo-input w-full px-3 py-2 text-sm font-mono"
                value={系统.sd.地址}
                placeholder="http://127.0.0.1:7860"
                onChange={(事件) => 补丁sd({ 地址: 事件.target.value })}
              />
            </字段>
            <字段 label="认证" hint="`user:pass` 形式；留空表示不鉴权。">
              <input
                type="password"
                className="kaituo-input w-full px-3 py-2 text-sm font-mono"
                value={系统.sd.认证}
                onChange={(事件) => 补丁sd({ 认证: 事件.target.value })}
              />
            </字段>
            <div className="flex flex-wrap items-center gap-2">
              <次级按钮 onClick={() => void 处理测试Sd()} disabled={测试中}>测试并读取模型列表</次级按钮>
            </div>
            {sd提示 ? <提示条 kind={sd提示.kind} text={sd提示.text} /> : null}
            <字段 label="模型" hint="点上面的按钮可拉取列表；也可手填。">
              {sd资源 && sd资源.模型.length > 0 ? (
                <select
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={系统.sd.模型}
                  onChange={(事件) => 补丁sd({ 模型: 事件.target.value })}
                >
                  <option value="">（不指定）</option>
                  {sd资源.模型.map((项) => <option key={项} value={项}>{项}</option>)}
                </select>
              ) : (
                <input
                  className="kaituo-input w-full px-3 py-2 text-sm font-mono"
                  value={系统.sd.模型}
                  onChange={(事件) => 补丁sd({ 模型: 事件.target.value })}
                />
              )}
            </字段>
            <div className="grid gap-3 md:grid-cols-2">
              <字段 label="采样器">
                {sd资源 && sd资源.采样器.length > 0 ? (
                  <select
                    className="kaituo-input w-full px-3 py-2 text-sm"
                    value={系统.sd.采样器}
                    onChange={(事件) => 补丁sd({ 采样器: 事件.target.value })}
                  >
                    {sd资源.采样器.map((项) => <option key={项} value={项}>{项}</option>)}
                  </select>
                ) : (
                  <input
                    className="kaituo-input w-full px-3 py-2 text-sm"
                    value={系统.sd.采样器}
                    onChange={(事件) => 补丁sd({ 采样器: 事件.target.value })}
                  />
                )}
              </字段>
              <字段 label="调度器">
                {sd资源 && sd资源.调度器.length > 0 ? (
                  <select
                    className="kaituo-input w-full px-3 py-2 text-sm"
                    value={系统.sd.调度器}
                    onChange={(事件) => 补丁sd({ 调度器: 事件.target.value })}
                  >
                    {sd资源.调度器.map((项) => <option key={项} value={项}>{项}</option>)}
                  </select>
                ) : (
                  <input
                    className="kaituo-input w-full px-3 py-2 text-sm"
                    value={系统.sd.调度器}
                    onChange={(事件) => 补丁sd({ 调度器: 事件.target.value })}
                  />
                )}
              </字段>
              <字段 label="VAE">
                <input
                  className="kaituo-input w-full px-3 py-2 text-sm font-mono"
                  value={系统.sd.VAE}
                  onChange={(事件) => 补丁sd({ VAE: 事件.target.value })}
                />
              </字段>
              <字段 label="CLIP 跳过层">
                <input
                  type="number"
                  min={1}
                  max={12}
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={系统.sd.CLIP跳过层}
                  onChange={(事件) => 补丁sd({ CLIP跳过层: Math.max(1, Number(事件.target.value) || 1) })}
                />
              </字段>
            </div>
          </面板>

          <面板 title="生成参数">
            <div className="grid gap-3 md:grid-cols-2">
              <字段 label="宽度">
                <input
                  type="number"
                  min={64}
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={系统.sd.宽度}
                  onChange={(事件) => 补丁sd({ 宽度: Math.max(64, Number(事件.target.value) || 1024) })}
                />
              </字段>
              <字段 label="高度">
                <input
                  type="number"
                  min={64}
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={系统.sd.高度}
                  onChange={(事件) => 补丁sd({ 高度: Math.max(64, Number(事件.target.value) || 1024) })}
                />
              </字段>
              <字段 label="步数">
                <input
                  type="number"
                  min={1}
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={系统.sd.步数}
                  onChange={(事件) => 补丁sd({ 步数: Math.max(1, Number(事件.target.value) || 28) })}
                />
              </字段>
              <字段 label="CFG Scale">
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={系统.sd.cfg}
                  onChange={(事件) => 补丁sd({ cfg: Number(事件.target.value) || 0 })}
                />
              </字段>
              <字段 label="种子" hint="-1 表示每次随机；0 是有效固定种子。">
                <input
                  type="number"
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={系统.sd.种子}
                  onChange={(事件) => 补丁sd({ 种子: Number(事件.target.value) })}
                />
              </字段>
            </div>
          </面板>

          <面板 title="修复" desc="高清修复与 ADetailer 都需要服务端装了对应扩展。">
            <开关行
              label="面部修复 (restore_faces)"
              checked={系统.sd.面部修复}
              onChange={(值) => 补丁sd({ 面部修复: 值 })}
            />
            <开关行
              label="ADetailer 面部重绘"
              desc="发出 alwayson_scripts.ADetailer，使用 face_yolov8n.pt。"
              checked={系统.sd.ADetailer}
              onChange={(值) => 补丁sd({ ADetailer: 值 })}
            />
            <开关行
              label="高清修复 (Hires fix)"
              checked={系统.sd.高清修复}
              onChange={(值) => 补丁sd({ 高清修复: 值 })}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <字段 label="放大算法">
                <select
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={系统.sd.高清放大算法}
                  onChange={(事件) => 补丁sd({ 高清放大算法: 事件.target.value })}
                >
                  {SD放大算法列表.map((项) => <option key={项} value={项}>{项}</option>)}
                </select>
              </字段>
              <字段 label="放大倍数">
                <input
                  type="number"
                  min={1}
                  max={4}
                  step={0.5}
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={系统.sd.高清放大倍数}
                  onChange={(事件) => 补丁sd({ 高清放大倍数: Math.max(1, Number(事件.target.value) || 1) })}
                />
              </字段>
              <字段 label="第二轮步数" hint="0 表示沿用主步数。">
                <input
                  type="number"
                  min={0}
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={系统.sd.高清第二轮步数}
                  onChange={(事件) => 补丁sd({ 高清第二轮步数: Math.max(0, Number(事件.target.value) || 0) })}
                />
              </字段>
              <字段 label="去噪强度">
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  className="kaituo-input w-full px-3 py-2 text-sm"
                  value={系统.sd.高清去噪强度}
                  onChange={(事件) => 补丁sd({ 高清去噪强度: Math.min(1, Math.max(0, Number(事件.target.value) || 0)) })}
                />
              </字段>
            </div>
          </面板>

          <提示条
            kind="info"
            text="LoRA 用提示词标签形式写在固定提示词里，例如 <lora:名称:0.8>，由 A1111 自己解析。这样同一段提示词也能直接给 ComfyUI 用。"
          />
        </div>
      )}

      {当前页 === 'banana' && (
        <div className="space-y-4">
          <面板
            title="连接"
            desc="OpenAI 兼容的独立纯文生图接口。端点按基址形态推导，也可在下面显式覆盖。"
          >
            <字段 label="地址">
              <input
                className="kaituo-input w-full px-3 py-2 text-sm font-mono"
                value={系统.banana.地址}
                placeholder="https://api.openai.com"
                onChange={(事件) => 补丁banana({ 地址: 事件.target.value })}
              />
            </字段>
            <字段 label="API Key">
              <input
                type="password"
                className="kaituo-input w-full px-3 py-2 text-sm font-mono"
                value={系统.banana.APIKey}
                onChange={(事件) => 补丁banana({ APIKey: 事件.target.value })}
              />
            </字段>
            <字段
              label="自定义端点"
              hint="留空则按基址推导；相对路径会拼在地址之后，绝对地址直接使用。"
            >
              <input
                className="kaituo-input w-full px-3 py-2 text-sm font-mono"
                value={系统.banana.自定义端点}
                placeholder="/v1/images/generations"
                onChange={(事件) => 补丁banana({ 自定义端点: 事件.target.value })}
              />
            </字段>
            <提示条 kind="info" text={`当前会请求：${Banana生成端点(系统.banana) || '（地址为空）'}`} />
            {系统.banana.参考图上传 ? (
              <提示条
                kind="info"
                text={`有参考图时改走 edits：${Banana编辑端点(系统.banana) || '（地址为空）'}`}
              />
            ) : null}
            <开关行
              label="启用参考图上传"
              desc="从角色卡的媒体里按「勾选的照片 → 参考用途 → 第一张图片」取一张，改走 edits 接口。"
              checked={系统.banana.参考图上传}
              onChange={(值) => 补丁banana({ 参考图上传: 值 })}
            />
            <字段 label="参考图发送形态" hint="multipart 是上游默认；部分中转站只认 JSON 形式。">
              <select
                className="kaituo-input w-full px-3 py-2 text-sm"
                value={系统.banana.编辑格式}
                onChange={(事件) => 补丁banana({ 编辑格式: 事件.target.value as typeof 系统.banana.编辑格式 })}
              >
                <option value="form_data">multipart/form-data（默认）</option>
                <option value="json">JSON（image 字段塞数据地址）</option>
              </select>
            </字段>
          </面板>

          <面板 title="生成参数">
            <字段 label="模型" hint="imagen 系列不会发送 size 参数。">
              <input
                className="kaituo-input w-full px-3 py-2 text-sm font-mono"
                list="banana-model-options"
                value={系统.banana.模型}
                onChange={(事件) => 补丁banana({ 模型: 事件.target.value })}
              />
            </字段>
            <datalist id="banana-model-options">
              {Banana模型列表.map((项) => <option key={项} value={项} />)}
            </datalist>
            <字段 label="尺寸" hint="`宽x高`。AI 自主分辨率开启时，提示词里的尺寸会覆盖它。">
              <input
                className="kaituo-input w-full px-3 py-2 text-sm font-mono"
                list="banana-size-options"
                value={系统.banana.尺寸}
                onChange={(事件) => 补丁banana({ 尺寸: 事件.target.value })}
              />
            </字段>
            <datalist id="banana-size-options">
              {Banana尺寸列表.map((项) => <option key={项} value={项} />)}
            </datalist>
            <字段 label="响应格式" hint="`none` 表示不发送该字段，由服务端决定。">
              <select
                className="kaituo-input w-full px-3 py-2 text-sm"
                value={系统.banana.响应格式}
                onChange={(事件) => 补丁banana({ 响应格式: 事件.target.value as typeof 系统.banana.响应格式 })}
              >
                <option value="none">不指定</option>
                <option value="url">url（返回远端地址）</option>
                <option value="b64_json">b64_json（返回 base64）</option>
              </select>
            </字段>
          </面板>

          <提示条
            kind="info"
            text="这一渠道没有独立的种子与步数参数，生成参数里对应的项会留空。它也不支持负面提示词，正负词会一起并入正向提示词。"
          />
        </div>
      )}

      {当前页 === 'converter' && (
        <LlmSettingsPanel
          LLM={系统.LLM}
          onChange={(下一项) => 补丁系统({ LLM: 下一项 })}
          主配置名={主API名}
          主配置模型={主API模型}
          主配置地址={主API地址}
          候选配置={LLM候选配置}
          onFetchModels={onFetchModels}
        />
      )}

      {当前页 === 'prompt' && (
        <div className="space-y-4">
          <FixedStylePanel
            画风={系统.提示词.固定画风}
            onChange={(下一项) => 补丁系统({ 提示词: { ...系统.提示词, 固定画风: 下一项 } })}
          />

          <面板 title="固定提示词预设" desc="按预设提供固定正面/负面词，与模型输出的主体提示词拼接。">
            <字段 label="当前预设">
              <select
                className="kaituo-input w-full px-3 py-2 text-sm"
                value={系统.提示词.当前预设}
                onChange={(事件) => 补丁系统({ 提示词: { ...系统.提示词, 当前预设: 事件.target.value } })}
              >
                {Object.keys(系统.提示词.预设列表).map((名称) => <option key={名称} value={名称}>{名称}</option>)}
              </select>
            </字段>
            <开关行
              label="随机预设"
              desc="每次生成从预设列表里随机抽一个，用于打散画风。"
              checked={系统.提示词.随机预设}
              onChange={(值) => 补丁系统({ 提示词: { ...系统.提示词, 随机预设: 值 } })}
            />
          </面板>

          <面板 title="替换规则" desc="每行一条：触发词=动作|插入词。动作有 前置前 / 前置后 / 后置前 / 后置后 / 最后置 / 替换 / 替换分角色。">
            <textarea
              className="kaituo-input h-48 w-full px-3 py-2 text-xs font-mono leading-relaxed"
              value={系统.提示词.替换规则列表[系统.提示词.当前替换规则]?.规则文本 ?? ''}
              spellCheck={false}
              placeholder={'陈思宇|张雅=前置前|<lora:Krea2:0.6>\n女孩=替换|1girl\n色情=替换|'}
              onChange={(事件) => 补丁系统({
                提示词: {
                  ...系统.提示词,
                  替换规则列表: {
                    ...系统.提示词.替换规则列表,
                    [系统.提示词.当前替换规则]: {
                      规则文本: 事件.target.value,
                      createdAt: 系统.提示词.替换规则列表[系统.提示词.当前替换规则]?.createdAt ?? Date.now(),
                      updatedAt: Date.now(),
                    },
                  },
                },
              })}
            />
          </面板>

          <面板 title="词汇替换" desc="每行 查找=替换；查找按字面量处理，按书写顺序套用，因此存在子串遮蔽。">
            <textarea
              className="kaituo-input h-40 w-full px-3 py-2 text-xs font-mono leading-relaxed"
              value={系统.提示词.词汇替换}
              spellCheck={false}
              onChange={(事件) => 补丁系统({ 提示词: { ...系统.提示词, 词汇替换: 事件.target.value } })}
            />
          </面板>
          <PromptPreviewPanel 系统={系统} 角色上下文={角色上下文} />
          <SelfCheckPanel 系统={系统} 可选资源={资源} />
        </div>
      )}

      {当前页 === 'character' && (
        <CharacterSettingsPanel
          settings={系统}
          onPatch={补丁系统}
          待追加={待追加标签}
          追加序号={追加序号}
          on追加目标变更={set追加目标}
          未保存={有未保存}
          请求生成={生成角色特征}
          角色AI候选配置={角色AI候选配置}
          主API模型={主API模型}
          主API地址={主API地址}
          onFetchModels={onFetchModels}
          LoRA列表={资源?.lora ?? []}
          on拉取LoRA={async () => {
            // 角色卡编辑页里也能拉：省得为了挑一个 LoRA 来回切页签。
            const 结果 = await onFetchResources(档案?.连接.地址 ?? '');
            set资源(结果);
            return 结果.lora;
          }}
        />
      )}

      {当前页 === 'vocabulary' && (
        <TagVocabularyPanel
          on追加={(标签串) => {
            set待追加标签(标签串);
            set追加序号((值) => 值 + 1);
            set保存提示({ kind: 'info', text: `已追加到角色字段「${追加目标}」，切回「角色管理」即可看到。` });
          }}
        />
      )}

      {当前页 === 'cache' && (
        <面板
          title="图片缓存"
          desc="按提示词归档；同一提示词的多次生成形成一条有序图廊。看图与删单张在「图片生成 → 图片缓存」页。"
        >
          <div className="flex flex-wrap gap-2">
            <次级按钮 onClick={() => void 处理缓存统计()}>统计容量</次级按钮>
            <次级按钮
              onClick={async () => {
                await onClearCache();
                set缓存信息(await onCacheStats());
              }}
            >
              清空缓存
            </次级按钮>
          </div>
          {缓存信息 ? (
            <提示条
              kind="info"
              text={`条目 ${缓存信息.条目数} 条 · 图片 ${缓存信息.图片数} 张 · 占用 ${格式化字节(缓存信息.总字节)}`}
            />
          ) : null}
          <字段 label="保留天数" hint="0 表示永久保留。">
            <input
              type="number"
              min={0}
              className="kaituo-input w-full px-3 py-2 text-sm"
              value={系统.图片缓存.保留天数}
              onChange={(事件) => 补丁系统({
                图片缓存: { ...系统.图片缓存, 保留天数: Math.max(0, Number(事件.target.value) || 0) },
              })}
            />
          </字段>
        </面板>
      )}

      {保存提示 ? <提示条 kind={保存提示.kind} text={保存提示.text} /> : null}
      <主按钮 onClick={() => void 处理保存()}>保存文生图设置</主按钮>
    </div>
  );
}
