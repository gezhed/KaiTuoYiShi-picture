import { useMemo, useRef, useState } from 'react';
import type { 角色AI消息, 角色卡, 角色部位字段, 文生图系统设置 } from '@/models/genSystem';
import { 创建默认角色AI设置, 角色部位字段名 } from '@/models/genSystem';
import type { API配置项 } from '@/models/settings';
import type { ConnectionTestConfig } from '@/hooks/useAiTools';
import {
  面板,
  提示条,
  次级按钮,
  开关行,
  设置字段 as 字段,
  主按钮,
} from '@/components/features/Settings/settingsPrimitives';
import { LLM接口字段 } from './LlmEndpointFields';
import { 部位字段标签, 建角色卡 } from './CharacterSettingsEditor';
import {
  从设置导出预设文本,
  下载文本文件,
  解析角色AI预设文本,
} from '@/services/ai/imageGen/characterAIPreset';
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
/** 「新建角色卡」在下拉里的占位值：真实 id 都带前缀，不会撞。 */
const 新建占位 = '__新建__';

export function CharacterAIPanel({
  设置,
  onPatch,
  当前角色,
  角色列表,
  on选择角色,
  写入角色,
  新建角色,
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
  /**
   * 新建一张角色卡（交给上层：它还要把这张卡挂进当前启用列表，
   * 否则生成了也进不了提示词——启用列表是一道独立闸门）。
   * 没提供时退回 `写入角色`（角色卡表本身就是按 id upsert）。
  */
  新建角色?: (角色: 角色卡) => void;
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
  const [提示, set提示] = useState('');
  const [勾选字段, set勾选字段] = useState<Set<keyof 角色部位字段>>(new Set());
  const [勾选服装, set勾选服装] = useState<Set<number>>(new Set());
  const [显示原始回复, set显示原始回复] = useState(false);
  const [追加服装, set追加服装] = useState(true);
  /** 目标选成「新建」时不再往已有卡上写，而是先建一张。 */
  const [新建模式, set新建模式] = useState(false);
  const [新卡名称, set新卡名称] = useState('');
  /**
   * 生成结果的可编辑副本。
   *
   * 之前只能整段写回角色卡、再去「角色卡」页改：改写一句 tag 要先落盘一次，
   * 不满意还得回滚。这里让每个字段在写回前就能改，改完才落盘。
   */
  const [字段草稿, set字段草稿] = useState<Record<string, string>>({});
  const [服装草稿列表, set服装草稿列表] = useState<服装草稿[]>([]);
  /** 导入预设的文件输入（隐藏，由按钮触发）。 */
  const 文件输入 = useRef<HTMLInputElement | null>(null);

  const 角色AI = 设置.角色AI;
  const 有要求 = 要求.trim().length > 0;
  // 没显式选卡时以第一张卡为目标：打开这个页签的人多半就是想给某张卡生成，
  // 让它落到一个空下拉会让人以为「必须先回去点一下」。
  const 目标角色 = 新建模式 ? undefined : (当前角色 ?? 角色列表[0]);

  const 可应用字段 = useMemo(() => {
    if (!结果) return [] as Array<{ 键: keyof 角色部位字段; 新值: string; 旧值: string; 已改: boolean }>;
    return 角色部位字段名
      .filter((键) => (结果.字段[键] ?? '').trim().length > 0)
      .map((键) => {
        const 生成值 = (结果.字段[键] ?? '').trim();
        const 草稿 = 字段草稿[键];
        return {
          键,
          新值: 草稿 ?? 生成值,
          旧值: 目标角色 ? (目标角色[键] ?? '') : '',
          已改: 草稿 !== undefined && 草稿 !== 生成值,
        };
      });
  }, [结果, 目标角色, 字段草稿]);

  /** 写回时用的字段值：取编辑过的内容，空值不写（与 `合并生成字段` 同一口径）。 */
  const 生效字段 = useMemo(() => {
    const 表: Partial<角色部位字段> = {};
    for (const { 键, 新值 } of 可应用字段) {
      if (勾选字段.has(键)) 表[键] = 新值;
    }
    return 表;
  }, [可应用字段, 勾选字段]);

  /**
   * 「写入后会是什么样」的那张卡。
   *
   * 写入与预览共用它，保证**预览看到的正是即将写进去的内容**：
   * 早先预览只读角色卡上已保存的字段，于是刚生成、还没点写入时，
   * 预览图里看不到「角色特征」等新内容 —— 用起来就像没载入角色特征。
   */
  const 待写入卡片 = useMemo(() => {
    const 基准 = 新建模式 ? 建角色卡(新卡名称.trim() || '新角色') : 目标角色;
    if (!基准) return undefined;
    let 卡 = 合并生成字段(基准, 生效字段, [...勾选字段]);
    const 新服装 = 服装草稿列表
      .filter((_, 序号) => 勾选服装.has(序号))
      .map((草稿: 服装草稿) => 服装草稿转条目(草稿));
    if (追加服装 && 新服装.length > 0) {
      卡 = { ...卡, outfits: [...(卡.outfits ?? []), ...新服装] };
    }
    return 卡;
  }, [新建模式, 新卡名称, 目标角色, 生效字段, 勾选字段, 服装草稿列表, 勾选服装, 追加服装]);


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
    set提示('');
    set结果(null);
    if (角色AI.消息.filter((项) => 项.enabled !== false).length === 0) {
      // 不拦着：任务消息本身也要求了 <人物> 格式，可能仍然可用。
      // 但必须说清「现在没有任何格式约束」，否则用户只会看到解析失败。
      set提示('当前预设是空白的：模型没有任何格式与尺度约束，多半给不出 <人物> 块。'
        + '可以导入「文生图教程/角色AI预设-人物生成.json」再试。');
    }
    set生成中(true);
    try {
      const 生成结果 = await 请求生成({ 系统: 设置, 要求, 角色: 目标角色 });
      // 容错：`服装` 不是数组时（异常返回/旧版本）不能让整段流程抛错 ——
      // 抛出去的话「字段照样显示、服装却静默没了」，现象与「服装保存不了」一样。
      const 服装草稿 = Array.isArray(生成结果.服装) ? 生成结果.服装 : [];
      set结果(生成结果);
      const 字段键 = 角色部位字段名.filter((键) => (生成结果.字段[键] ?? '').trim().length > 0);
      set勾选字段(new Set(字段键));
      set勾选服装(new Set(服装草稿.map((_, 序号) => 序号)));
      // 每轮生成都重置草稿：上一轮的改动不该悄悄带到这一次。
      set字段草稿({});
      set服装草稿列表(服装草稿);
      // 新建模式：默认拿模型给的中文名当卡名，省得再敲一遍。
      if (新建模式) set新卡名称((值) => 值.trim() || (生成结果.字段.nameCN ?? '').trim());
      if (字段键.length === 0) {
        set显示原始回复(true);
        // 服务侧会把空回分类（安全拦截 / 额度耗尽 / 只回推理 / 没到模型），
        // 有诊断就照它说，没有才用通用文案 —— 处置办法完全不同。
        set错误(生成结果.诊断
          ?? '模型没有给出可解析的 <人物> 区块，下面附上它的原始回复。');
      } else if (生成结果.重试次数 > 0) {
        set错误('');
        set提示(`第 ${生成结果.重试次数 + 1} 次尝试才拿到可用内容（空回已自动重问）。`);
      } else if (服装草稿.length === 0) {
        set提示(`拿到 ${字段键.length} 个部位字段；模型这次没有给出 <服装> 区块，所以没有服装可写。`);
      } else {
        set提示(`拿到 ${字段键.length} 个部位字段、${服装草稿.length} 件服装（都可以先改再写）。`);
      }
    } catch (异常) {
      set错误(异常 instanceof Error ? 异常.message : String(异常));
    } finally {
      set生成中(false);
    }
  };

  const 应用 = () => {
    if (!结果) return;
    if (!新建模式 && !目标角色) return;
    if (!待写入卡片) return;
    // 用**编辑后**的值写回（`待写入卡片` 已经按「勾选 + 空值不覆盖」算好）；
    // 预览用的是同一份，所以「预览看到的」与「写进去的」一致。
    // 服装已经由 `待写入卡片` 合并进去了，这里只统计名字与数量 ——
    // 再合并一次会把同一件衣服写两遍（写回与预览共用同一份，必须只有一个合并点）。
    const 新写入服装名: string[] = 追加服装
      ? 服装草稿列表
        .filter((_, 序号) => 勾选服装.has(序号))
        .map((草稿: 服装草稿) => 服装草稿转条目(草稿).name)
      : [];
    const 下一 = 待写入卡片;
    const 写入字段数 = [...勾选字段].filter((键) => (生效字段[键] ?? '').trim().length > 0).length;
    const 写入服装数 = 追加服装
      ? 服装草稿列表.filter((_, 序号) => 勾选服装.has(序号)).length
      : 0;
    if (新建模式) {
      // 上层还会把这张卡挂进当前启用列表，否则它在提示词里不可见。
      if (新建角色) 新建角色(下一);
      else 写入角色(下一);
      on选择角色(下一.id);
      set新建模式(false);
      set新卡名称('');
    } else {
      写入角色(下一);
    }
    /*
     * 回执必须把「服装为什么没写」说全。
     *
     * 以前这里只在写入成功时提一句服装：开关关着、或一件都没勾时**只字不提**，
     * 用户看到「已写入 N 个部位字段」自然以为服装也写了 —— 实际没有。
     * 三种情况分开说：写了 / 开关关着 / 一件都没勾。
     */
    const 写入了什么 = [`${写入字段数} 个部位字段`];
    if (写入服装数 > 0) 写入了什么.push(`${写入服装数} 件服装（${新写入服装名.join('、')}）`);
    const 回执 = [`已写入 ${写入了什么.join('、')} →「${下一.nameCN || '未命名'}」。`];
    if (服装草稿列表.length === 0) {
      回执.push('模型这次没有给出 <服装> 区块，所以没有服装可写。');
    } else if (!追加服装) {
      回执.push(`服装没有写入：「同时写入生成的服装」开关是关的（有 ${服装草稿列表.length} 件待写）。`);
    } else if (写入服装数 < 服装草稿列表.length) {
      回执.push(`另有 ${服装草稿列表.length - 写入服装数} 件没有勾选，未写入。`);
    }
    set错误('');
    set提示(回执.join(''));
    set结果(null);
    set要求('');
    set字段草稿({});
    set服装草稿列表([]);
  };

  /** 改一个部位字段的草稿值。 */
  const 改字段 = (键: keyof 角色部位字段, 值: string) => {
    set字段草稿((表) => ({ ...表, [键]: 值 }));
  };

  /** 改一张服装草稿的某个字段。 */
  const 改服装 = (序号: number, 键: keyof 服装草稿, 值: string) => {
    set服装草稿列表((列表) => 列表.map((项, 位置) => (位置 === 序号 ? { ...项, [键]: 值 } : 项)));
  };

  const 切换字段 = (键: keyof 角色部位字段) => {
    const 下一 = new Set(勾选字段);
    if (下一.has(键)) 下一.delete(键); else 下一.add(键);
    set勾选字段(下一);
  };

  /**
   * 导入预设 JSON。
   *
   * 预设默认是空白的（不再是内置那一份），所以这条路是**主入口**：
   * 仓库里 `文生图教程/角色AI预设-人物生成.json` 就是「人物生成」那份。
   * 导入只覆盖它明确给出的项：没写的参数保留当前值。
   */
  const 处理导入预设 = async (文件列表: FileList | null) => {
    const 文件 = 文件列表?.[0];
    if (!文件) return;
    try {
      const 文本 = await 文件.text();
      const { 预设, 错误 } = 解析角色AI预设文本(文本);
      if (!预设) {
        set错误(`导入失败：${错误 ?? '文件里没有可用的提示词消息。'}`);
        return;
      }
      onPatch({
        角色AI: {
          ...角色AI,
          消息: 预设.消息,
          ...(预设.参数?.附加要求 !== undefined ? { 附加要求: 预设.参数.附加要求 } : {}),
          ...(预设.参数?.温度 !== undefined ? { 温度: 预设.参数.温度 } : {}),
          ...(预设.参数?.最大输出 !== undefined ? { 最大输出: 预设.参数.最大输出 } : {}),
          ...(预设.参数?.重试次数 !== undefined ? { 重试次数: 预设.参数.重试次数 } : {}),
        },
      });
      set错误('');
      set提示(`已导入「${预设.名称 ?? 文件.name}」：${预设.消息.length} 条消息`
        + `（启用 ${预设.消息.filter((项) => 项.enabled !== false).length} 条）。`);
    } catch (异常) {
      set错误(`导入失败：${异常 instanceof Error ? 异常.message : String(异常)}`);
    }
  };

  const 处理导出预设 = () => {
    const 名称 = 目标角色?.nameCN ? `${目标角色.nameCN}-角色AI预设` : '角色AI预设';
    下载文本文件(`${名称}.json`, 从设置导出预设文本(角色AI, 名称));
    set提示('已导出当前预设（JSON 文件）。');
  };

  const 处理清空预设 = () => {
    onPatch({ 角色AI: { ...角色AI, 消息: [], 附加要求: '' } });
    set提示('已清空为空白预设。');
  };

  const 补丁消息 = (序号: number, 部分: Partial<角色AI消息>) => {
    onPatch({
      角色AI: {
        ...角色AI,
        消息: 角色AI.消息.map((项, 位置) => (位置 === 序号 ? { ...项, ...部分 } : 项)),
      },
    });
  };

  const 移动消息 = (序号: number, 方向: -1 | 1) => {
    const 目标 = 序号 + 方向;
    if (目标 < 0 || 目标 >= 角色AI.消息.length) return;
    const 下一 = [...角色AI.消息];
    [下一[序号], 下一[目标]] = [下一[目标], 下一[序号]];
    onPatch({ 角色AI: { ...角色AI, 消息: 下一 } });
  };

  const 删除消息 = (序号: number) => {
    onPatch({ 角色AI: { ...角色AI, 消息: 角色AI.消息.filter((_, 位置) => 位置 !== 序号) } });
  };

  return (
    <div className="space-y-4">
      <面板
        title="一键生成角色特征"
        desc="用「人物生成」提示词让模型按格式产出 14 个部位字段，解析后先给你过一遍再写回角色卡。生成过程与出图无关，不会消耗生图额度。"
      >
        <字段
          label="目标角色卡"
          hint="写到已有卡上，或选「＋ 新建角色卡」直接造一张（会自动挂进当前启用列表）。"
        >
          <select
            aria-label="目标角色卡"
            className="kaituo-input w-full px-2 py-1.5 text-xs"
            value={新建模式 ? 新建占位 : (目标角色?.id ?? '')}
            onChange={(事件) => {
              if (事件.target.value === 新建占位) {
                set新建模式(true);
                set结果(null);
                return;
              }
              set新建模式(false);
              on选择角色(事件.target.value);
            }}
          >
            <option value={新建占位}>＋ 新建角色卡</option>
            {角色列表.length === 0 ? <option value="">（还没有角色卡）</option> : null}
            {角色列表.map((角色) => (
              <option key={角色.id} value={角色.id}>
                {[角色.nameCN, 角色.nameEN].filter(Boolean).join(' / ') || 角色.id}
              </option>
            ))}
          </select>
        </字段>

        {新建模式 ? (
          <字段
            label="新角色卡名称"
            hint="留空就用模型给出的中文名称；写入后可在「角色卡」页继续补别名、头像与媒体。"
          >
            <input
              className="kaituo-input w-full px-2 py-1.5 text-xs"
              value={新卡名称}
              placeholder="例：流萤"
              onChange={(事件) => set新卡名称(事件.target.value)}
            />
          </字段>
        ) : null}

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
          <次级按钮
            disabled={生成中}
            onClick={() => {
              set结果(null);
              set字段草稿({});
              set服装草稿列表([]);
              set错误('');
              set提示('');
            }}
          >
            清空结果
          </次级按钮>
          <span className="text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.68)' }}>
            {请求生成 ? '接口：角色 AI 覆盖 → 文生图 LLM → 主 API。' : '（当前入口未接模型调用）'}
          </span>
        </div>

        {错误 ? <提示条 kind="error" text={错误} /> : null}
        {!错误 && 提示 ? <提示条 kind="info" text={提示} /> : null}

        {结果 && (可应用字段.length > 0 || 服装草稿列表.length > 0) ? (
          <面板
            title={`生成结果（${可应用字段.length} 个字段，默认全选）`}
            desc={`每个字段都能当场改（改完再写回，不必先保存再去角色卡页改）。取消勾选的不写入；生成值为空的字段一律不写回。${新建模式 ? '当前是新建模式：写入会建一张新卡并挂进启用列表。' : ''}`}
          >
            {/* 限高：14 个字段每段都是长 tag 串，不限制会把「写入角色卡」推到大半屏之外。 */}
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {可应用字段.map(({ 键, 新值, 旧值, 已改 }) => (
                <div
                  key={键}
                  className="flex items-start gap-2 px-2 py-2"
                  style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))' }}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={勾选字段.has(键)}
                    onChange={() => 切换字段(键)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-serif text-xs tracking-wider" style={{ color: 'rgb(var(--tj-accent-primary))' }}>
                        {部位字段标签[键]}
                      </span>
                      {已改 ? (
                        <span className="text-[10px]" style={{ color: 'rgba(var(--tj-tech-cyan), 0.9)' }}>已手工修改</span>
                      ) : null}
                    </span>
                    {/* 生成的值当场可改：之前只能先写回角色卡、再去「角色卡」页改。 */}
                    <textarea
                      className="kaituo-input mt-1 h-16 w-full px-2 py-1 font-mono text-[11px] leading-relaxed"
                      value={新值}
                      spellCheck={false}
                      onChange={(事件) => 改字段(键, 事件.target.value)}
                    />
                    {旧值 ? (
                      <span className="mt-0.5 block break-words font-mono text-[11px] leading-relaxed line-through" style={{ color: 'rgba(var(--tj-text-secondary), 0.6)' }}>
                        {旧值}
                      </span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>

            {服装草稿列表.length > 0 ? (
              <div className="space-y-2">
                <开关行
                  label="同时写入生成的服装"
                  desc={`模型给出了 <服装> 区块；关掉则只写角色字段。每一项都能当场改。当前会写入 ${勾选服装.size} / ${服装草稿列表.length} 件（取消勾选的不写）。`}
                  checked={追加服装}
                  onChange={set追加服装}
                />
                {追加服装 ? (
                  <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                    {服装草稿列表.map((草稿, 序号) => (
                      <div
                        key={`${序号}-${草稿.name}`}
                        className="space-y-1 px-2 py-1.5"
                        style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))' }}
                      >
                        {/*
                          这里**不能**用 <label> 把输入框一起包进来：label 会把点击
                          （包括点在输入框旁边的空白上）转发给复选框，用户编辑服装名时
                          很容易顺手把它取消勾选 —— 于是「身体字段写了、服装没写」，
                          而且界面上看不出发生了什么。
                        */}
                        <div className="flex items-center gap-2 text-[11px]">
                          <input
                            type="checkbox"
                            aria-label={`写入第 ${序号 + 1} 件服装`}
                            checked={勾选服装.has(序号)}
                            onChange={() => {
                              const 下一 = new Set(勾选服装);
                              if (下一.has(序号)) 下一.delete(序号); else 下一.add(序号);
                              set勾选服装(下一);
                            }}
                          />
                          <input
                            className="kaituo-input min-w-0 flex-1 px-1.5 py-0.5 font-serif text-[11px]"
                            value={草稿.name}
                            placeholder="服装中文名称"
                            onChange={(事件) => 改服装(序号, 'name', 事件.target.value)}
                          />
                          <input
                            className="kaituo-input w-32 px-1.5 py-0.5 font-mono text-[11px]"
                            value={草稿.英文名称}
                            placeholder="英文名称"
                            onChange={(事件) => 改服装(序号, '英文名称', 事件.target.value)}
                          />
                        </div>
                        {([
                          ['上半身', '上半身'],
                          ['上半身背面', '上半身背面'],
                          ['下半身', '下半身'],
                          ['下半身背面', '下半身背面'],
                          ['全身', '全身'],
                          ['负面', '负面'],
                        ] as Array<[keyof 服装草稿, string]>).map(([键, 标签]) => (
                          <label key={键} className="flex items-start gap-2">
                            <span
                              className="w-16 shrink-0 pt-1 text-right text-[10px]"
                              style={{ color: 'rgba(var(--tj-text-secondary), 0.72)' }}
                            >
                              {标签}
                            </span>
                            <textarea
                              className="kaituo-input h-10 min-w-0 flex-1 px-1.5 py-0.5 font-mono text-[11px] leading-relaxed"
                              value={草稿[键]}
                              spellCheck={false}
                              onChange={(事件) => 改服装(序号, 键, 事件.target.value)}
                            />
                          </label>
                        ))}
                      </div>
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

            <主按钮
              onClick={应用}
              disabled={(!新建模式 && !目标角色) || (勾选字段.size === 0 && 勾选服装.size === 0)}
            >
              {新建模式 ? `新建角色卡${新卡名称.trim() ? `「${新卡名称.trim()}」` : ''}并写入` : '写入角色卡'}
            </主按钮>
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
        desc="提示词默认取用户的「人物生成」预设：它是一段对话（破甲样例 + 格式规格），顺序即语义，所以这里按消息逐条管理。接口留空时依次回退：文生图 LLM 预设 → 主 API。"
      >
        <面板
          title={`提示词消息（${角色AI.消息.length} 条，启用 ${角色AI.消息.filter((项) => 项.enabled !== false).length} 条）`}
          desc="预设默认是空白的，从 JSON 文件导入（仓库里「文生图教程/角色AI预设-人物生成.json」就是「人物生成」那一份）。顺序即语义，停用某条就不发它。列表限高，可内部滚动（每条都能单独改与启停）。"
        >
          {/* 限高：8 条消息各带一个多行文本框，全展开会把下面的接口设置与「保存」顶到很远。 */}
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
            {角色AI.消息.map((项, 序号) => (
              <div
                key={项.id}
                className="space-y-1.5 px-2 py-2"
                style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))' }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="kaituo-input px-1.5 py-1 text-[11px]"
                    value={项.role}
                    onChange={(事件) => 补丁消息(序号, { role: 事件.target.value as 角色AI消息['role'] })}
                  >
                    <option value="system">system</option>
                    <option value="user">user</option>
                    <option value="assistant">assistant</option>
                  </select>
                  <次级按钮
                    active={项.enabled !== false}
                    onClick={() => 补丁消息(序号, { enabled: 项.enabled === false })}
                  >
                    {项.enabled === false ? '已停用' : '启用中'}
                  </次级按钮>
                  <span className="text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.62)' }}>
                    {项.content.length} 字
                  </span>
                  <div className="ml-auto flex gap-1">
                    <次级按钮 disabled={序号 === 0} onClick={() => 移动消息(序号, -1)}>↑</次级按钮>
                    <次级按钮 disabled={序号 === 角色AI.消息.length - 1} onClick={() => 移动消息(序号, 1)}>↓</次级按钮>
                    <次级按钮 onClick={() => 删除消息(序号)}>删除</次级按钮>
                  </div>
                </div>
                <textarea
                  className="kaituo-input h-28 w-full px-2 py-1.5 text-[11px] leading-relaxed"
                  value={项.content}
                  spellCheck={false}
                  onChange={(事件) => 补丁消息(序号, { content: 事件.target.value })}
                />
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <次级按钮
              onClick={() => onPatch({
                角色AI: {
                  ...角色AI,
                  消息: [...角色AI.消息, {
                    id: `msg_${Date.now().toString(36)}`,
                    role: 'system',
                    content: '',
                    enabled: true,
                  }],
                },
              })}
            >
              新增一条
            </次级按钮>
            <次级按钮 onClick={() => 文件输入.current?.click()}>导入预设 JSON</次级按钮>
            <次级按钮 disabled={角色AI.消息.length === 0} onClick={处理导出预设}>导出当前预设</次级按钮>
            <次级按钮
              disabled={角色AI.消息.length === 0 && !角色AI.附加要求}
              onClick={处理清空预设}
            >
              清空为空白
            </次级按钮>
            <次级按钮 onClick={() => onPatch({ 角色AI: { ...创建默认角色AI设置() } })}>
              恢复全部默认（空白）
            </次级按钮>
            {/* 隐藏的文件选择：预设改成导入制，这就是主入口。 */}
            <input
              ref={文件输入}
              type="file"
              accept=".json,application/json"
              aria-label="选择预设 JSON 文件"
              className="hidden"
              onChange={(事件) => {
                void 处理导入预设(事件.target.files);
                // 清掉 value：同一个文件连选两次也要能触发。
                事件.target.value = '';
              }}
            />
          </div>

          {角色AI.消息.length === 0 ? (
            <提示条
              kind="info"
              text={'预设是空白的：模型不会收到任何格式与尺度约束，一键生成多半拿不到 <人物> 块。'
                + '点「导入预设 JSON」选「文生图教程/角色AI预设-人物生成.json」（破甲对话 + 格式规格），'
                + '也可以自己写几条（第一条建议用 system）。'}
            />
          ) : null}
        </面板>

        <字段
          label="附加要求（可选）"
          hint="拼在消息序列之后、本次任务之前。想补一句自己的规格或口味就写在这里，不必改内置消息。"
        >
          <textarea
            className="kaituo-input h-20 w-full px-2 py-1.5 text-xs leading-relaxed"
            value={角色AI.附加要求}
            spellCheck={false}
            onChange={(事件) => onPatch({ 角色AI: { ...角色AI, 附加要求: 事件.target.value } })}
          />
        </字段>

        <div className="grid gap-2 md:grid-cols-3">
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
          <字段 label="最大输出" hint="14 个字段都是 tag 串；破甲对话也会占输出，给 12288 以上更稳。">
            <input
              type="number"
              min={256}
              step={256}
              className="kaituo-input w-full px-2 py-1.5 text-sm"
              value={角色AI.最大输出}
              onChange={(事件) => {
                const 值 = Number(事件.target.value);
                onPatch({ 角色AI: { ...角色AI, 最大输出: Number.isFinite(值) ? Math.max(256, Math.trunc(值)) : 12288 } });
              }}
            />
          </字段>
          <字段 label="空回重试次数" hint="解析不到 <人物> 块时自动重问几次。0 表示只问一次。">
            <input
              type="number"
              min={0}
              max={5}
              className="kaituo-input w-full px-2 py-1.5 text-sm"
              value={角色AI.重试次数}
              onChange={(事件) => {
                const 值 = Number(事件.target.value);
                onPatch({ 角色AI: { ...角色AI, 重试次数: Number.isFinite(值) ? Math.min(5, Math.max(0, Math.trunc(值))) : 1 } });
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
