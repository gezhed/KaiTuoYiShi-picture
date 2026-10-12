import { useCallback, useEffect, useRef, useState } from 'react';
import type { 角色参考条目, 角色媒体, 角色参考组 } from '@/models/genSystem';
import { 角色参考上限 } from '@/models/genSystem';
import { 读取角色媒体数据地址 } from '@/services/characterMedia';
import { Vibe编码键, Vibe模型已知, 解析Vibe条目数据 } from '@/services/ai/imageGen/novelaiVibe';
import { 面板, 提示条, 次级按钮, 设置字段 as 字段 } from '@/components/features/Settings/settingsPrimitives';

const 类型选项: Array<{ 值: 角色参考条目['类型']; 标签: string; 说明: string }> = [
  { 值: 'character', 标签: '角色', 说明: '只参考人物本身' },
  { 值: 'character_style', 标签: '角色+画风', 说明: '人物与画风都参考' },
  { 值: 'style', 标签: '仅画风', 说明: '只参考风格，不参考人物' },
];

/**
 * NovelAI 角色参考组编辑器。
 *
 * 上限 4 张与上游一致（L93410-L93414）。「保真度」在界面上不暴露，
 * 因为上游根本不发送它——发送的是 `1 - 强度`（L84068）。
 * 把它摆出来只会让人以为调它有用。
 */
export function NovelAIReferencePanel({
  参考组,
  媒体列表,
  模式,
  on模式变更,
  模型,
  onChange,
}: {
  参考组: 角色参考组 | undefined;
  /** 该角色可选的图片媒体（音频与参考之外的照片都能选）。 */
  媒体列表: 角色媒体[];
  /** 参考模式由 NovelAI 全局设置决定，这里只做切换入口。 */
  模式: 'character' | 'vibe';
  on模式变更: (下一模式: 'character' | 'vibe') => void;
  /** 当前模型，用于解析 Vibe 文件的编码键。 */
  模型: string;
  onChange: (下一组: 角色参考组) => void;
}) {
  const 条目列表 = 参考组?.references ?? [];
  const [缩略图, set缩略图] = useState<Record<string, string>>({});
  const [提示, set提示] = useState<string>('');
  const 是Vibe = 模式 === 'vibe';
  const 文件输入 = useRef<HTMLInputElement | null>(null);

  // Vibe 模式下 `媒体Id` 存的是 Vibe JSON 文本，不是媒体库 id，所以不做缩略图。
  const 刷新缩略图 = useCallback(async (列表: 角色参考条目[]) => {
    if (是Vibe) return;
    const 结果: Record<string, string> = {};
    for (const 项 of 列表) {
      try {
        结果[项.媒体Id] = await 读取角色媒体数据地址(项.媒体Id);
      } catch {
        // 单张读不出来只影响预览。
      }
    }
    set缩略图(结果);
  }, [是Vibe]);

  useEffect(() => {
    void 刷新缩略图(条目列表);
    // 只在条目身份变化时重读，避免调强度就重读全部图片。
  }, [条目列表.map((项) => 项.媒体Id).join('|'), 刷新缩略图]);

  const 写入 = (下一列表: 角色参考条目[]) => {
    const 时间 = Date.now();
    onChange({
      references: 下一列表,
      createdAt: 参考组?.createdAt ?? 时间,
      updatedAt: 时间,
    });
  };

  const 加入 = (媒体Id: string) => {
    if (条目列表.length >= 角色参考上限) {
      set提示(`已达到最大数量（${角色参考上限} 个）。`);
      return;
    }
    if (条目列表.some((项) => 项.媒体Id === 媒体Id)) {
      set提示('这张图已经在参考组里了。');
      return;
    }
    set提示('');
    写入([...条目列表, { 媒体Id, 类型: 'character', 强度: 0.6, 保真度: 0.6 }]);
  };

  const 处理Vibe上传 = async (文件列表: FileList | null) => {
    if (!文件列表 || 文件列表.length === 0) return;
    const 新增: 角色参考条目[] = [];
    const 失败: string[] = [];
    for (const 文件 of Array.from(文件列表)) {
      if (条目列表.length + 新增.length >= 角色参考上限) {
        失败.push(`${文件.name}：已达上限 ${角色参考上限} 个`);
        continue;
      }
      try {
        const 文本 = await 文件.text();
        // 先解析一次，确认这个文件里确实有当前模型的编码——不然加进去也是空的。
        const 结果 = 解析Vibe条目数据({ 媒体Id: 文本, 类型: 'style', 强度: 0.6, 保真度: 0.6 }, 模型);
        if (!结果.编码) {
          失败.push(`${文件.name}：${结果.错误 ?? '无法提取编码'}`);
          continue;
        }
        新增.push({ 媒体Id: 文本, 类型: 'style', 强度: 0.6, 保真度: 0.6 });
      } catch (错误) {
        失败.push(`${文件.name}：${错误 instanceof Error ? 错误.message : String(错误)}`);
      }
    }
    if (新增.length > 0) 写入([...条目列表, ...新增]);
    set提示(
      失败.length === 0
        ? `已加入 ${新增.length} 个 Vibe（当前模型编码：${Vibe编码键(模型)}）。`
        : `成功 ${新增.length} 个，失败：\n${失败.join('\n')}`,
    );
  };

  const 补丁 = (下标: number, 部分: Partial<角色参考条目>) => {
    写入(条目列表.map((项, 序号) => (序号 === 下标 ? { ...项, ...部分 } : 项)));
  };

  const 可加入 = 媒体列表.filter(
    (项) => 项.用途 !== 'audio' && !条目列表.some((已选) => 已选.媒体Id === 项.id),
  );

  return (
    <面板
      title={`NovelAI 参考组（${条目列表.length}/${角色参考上限}）`}
      desc="两种机制互斥：角色参考发图片（Director Reference），Vibe 发已编码的特征串（.naiv4vibe）。"
    >
      <div className="flex flex-wrap items-center gap-2">
        <次级按钮 active={!是Vibe} onClick={() => { on模式变更('character'); set提示(''); }}>
          角色参考（图片）
        </次级按钮>
        <次级按钮 active={是Vibe} onClick={() => { on模式变更('vibe'); set提示(''); }}>
          Vibe transfer（编码串）
        </次级按钮>
      </div>

      {是Vibe ? (
        <提示条
          kind="info"
          text={`Vibe 不是直接发图片，而是发 .naiv4vibe 里已编码的特征串。`
            + `当前模型「${模型 || '未设置'}」对应编码键「${Vibe编码键(模型)}」`
            + `${Vibe模型已知(模型) ? '' : '（未知模型，已退回默认键）'}。`}
        />
      ) : null}

      {条目列表.length === 0 ? (
        <提示条
          kind="info"
          text={是Vibe ? '还没有 Vibe。下面上传 .naiv4vibe 文件。' : '还没有参考图。下面点图片即可加入，最多 4 张。'}
        />
      ) : (
        <div className="space-y-2">
          {条目列表.map((条目, 下标) => (
            <div
              key={`${条目.媒体Id.slice(0, 24)}-${下标}`}
              className="flex flex-wrap items-center gap-2 p-2"
              style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))' }}
            >
              {是Vibe ? (
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center text-[10px]"
                  style={{ background: 'rgba(var(--tj-ui-panel-strong), 0.5)', color: 'rgba(var(--tj-text-secondary), 0.75)' }}
                  title="Vibe 编码串"
                >
                  Vibe
                </div>
              ) : 缩略图[条目.媒体Id] ? (
                <img
                  src={缩略图[条目.媒体Id]}
                  alt=""
                  className="h-12 w-12 shrink-0 object-cover"
                  style={{ border: '1px solid rgba(var(--tj-text-primary), var(--tj-edge-weak))' }}
                />
              ) : (
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center text-[10px]"
                  style={{ background: 'rgba(var(--tj-ui-panel-strong), 0.5)', color: 'rgba(var(--tj-text-secondary), 0.7)' }}
                >
                  无预览
                </div>
              )}
              {!是Vibe ? (
                <select
                  className="kaituo-input px-2 py-1 text-[11px]"
                  value={条目.类型}
                  onChange={(事件) => 补丁(下标, { 类型: 事件.target.value as 角色参考条目['类型'] })}
                  title={类型选项.find((项) => 项.值 === 条目.类型)?.说明}
                >
                  {类型选项.map((项) => <option key={项.值} value={项.值}>{项.标签}</option>)}
                </select>
              ) : null}
              <label className="flex items-center gap-1 text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.85)' }}>
                强度
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={条目.强度}
                  onChange={(事件) => 补丁(下标, { 强度: Number(事件.target.value) })}
                />
                <span className="w-8 font-mono">{条目.强度.toFixed(2)}</span>
              </label>
              <button
                type="button"
                onClick={() => 写入(条目列表.filter((_项, 序号) => 序号 !== 下标))}
                className="px-1 text-[11px] transition-all hover:opacity-80"
                style={{ color: 'rgb(var(--tj-danger))' }}
                title="移除"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {提示 ? <提示条 kind="info" text={提示} /> : null}

      {是Vibe ? (
        <>
          <label
            className="inline-block cursor-pointer px-3 py-2 text-xs font-serif tracking-wider transition-all hover:opacity-85"
            style={{
              color: 'rgba(var(--tj-text-primary), 0.86)',
              background: 'rgba(var(--tj-ui-panel-strong), 0.5)',
              border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))',
            }}
          >
            上传 .naiv4vibe 文件
            <input
              ref={文件输入}
              type="file"
              accept=".naiv4vibe,application/json,.json"
              multiple
              className="hidden"
              onChange={(事件) => {
                void 处理Vibe上传(事件.target.files);
                事件.target.value = '';
              }}
            />
          </label>
          <提示条
            kind="info"
            text="上传时会先按当前模型验证能否取出编码，取不到的文件会被拒绝并说明原因（而不是加进去后静默无效）。"
          />
        </>
      ) : 可加入.length > 0 ? (
        <字段 label="从角色媒体加入">
          <div className="flex flex-wrap gap-1">
            {可加入.map((项) => (
              <次级按钮 key={项.id} onClick={() => 加入(项.id)}>{项.name}</次级按钮>
            ))}
          </div>
        </字段>
      ) : 媒体列表.length === 0 ? (
        <提示条 kind="info" text="先在下面的「媒体」里上传图片，再回来加入参考组。" />
      ) : (
        <提示条 kind="info" text="所有图片都已加入参考组。" />
      )}
    </面板>
  );
}
