import { useCallback, useEffect, useState } from 'react';
import type { 角色媒体 } from '@/models/genSystem';
import {
  保存角色媒体,
  删除角色媒体,
  读取角色媒体数据地址,
  统计角色媒体,
} from '@/services/characterMedia';
import { 面板, 提示条 } from '@/components/features/Settings/settingsPrimitives';

/**
 * 角色媒体管理。
 *
 * 媒体字节存进独立库，设置对象里只留 id —— 上游同样只在设置里留 id
 * （`config_images` 存字节），否则参考图一多，设置对象与存档都会急剧膨胀。
 *
 * 参考图现在就能作为出图输入被取用；「哪张参与生成」的选择在角色卡上，
 * 这里只管上传、预览与删除。
 */
export function CharacterMediaPanel({
  角色Id,
  媒体列表,
  onChange,
}: {
  角色Id: string;
  媒体列表: 角色媒体[];
  onChange: (next: 角色媒体[]) => void;
}) {
  const [预览, set预览] = useState<Record<string, string>>({});
  const [提示, set提示] = useState<{ kind: 'info' | 'ok' | 'error'; text: string } | null>(null);
  const [占用, set占用] = useState<{ 数量: number; 总字节: number } | null>(null);

  const 刷新预览 = useCallback(async (列表: 角色媒体[]) => {
    const 结果: Record<string, string> = {};
    for (const 项 of 列表) {
      if (项.用途 === 'audio') continue;
      try {
        结果[项.id] = await 读取角色媒体数据地址(项.id);
      } catch {
        // 单张读不出来不该影响其它图；预览位留空。
      }
    }
    set预览(结果);
  }, []);

  useEffect(() => {
    void 刷新预览(媒体列表);
  }, [媒体列表, 刷新预览]);

  useEffect(() => {
    void 统计角色媒体().then(set占用).catch(() => set占用(null));
  }, [媒体列表]);

  const 处理上传 = async (文件列表: FileList | null) => {
    if (!文件列表 || 文件列表.length === 0) return;
    const 新增: 角色媒体[] = [];
    const 失败: string[] = [];
    for (const 文件 of Array.from(文件列表)) {
      try {
        新增.push(await 保存角色媒体({ 角色Id, blob: 文件, name: 文件.name }));
      } catch (错误) {
        失败.push(`${文件.name}：${错误 instanceof Error ? 错误.message : String(错误)}`);
      }
    }
    if (新增.length > 0) onChange([...媒体列表, ...新增]);
    set提示(
      失败.length === 0
        ? { kind: 'ok', text: `已加入 ${新增.length} 个媒体文件。` }
        : { kind: 新增.length > 0 ? 'info' : 'error', text: `成功 ${新增.length} 个，失败：\n${失败.join('\n')}` },
    );
  };

  const 处理删除 = async (媒体: 角色媒体) => {
    await 删除角色媒体(媒体.id);
    onChange(媒体列表.filter((项) => 项.id !== 媒体.id));
    set提示({ kind: 'info', text: `已删除 ${媒体.name}。` });
  };

  const 格式化字节 = (字节: number) => (
    字节 < 1024 ? `${字节} B`
      : 字节 < 1024 * 1024 ? `${(字节 / 1024).toFixed(1)} KB`
        : `${(字节 / 1024 / 1024).toFixed(1)} MB`
  );

  return (
    <面板
      title={`媒体（${媒体列表.length}）`}
      desc="参考图 / 照片 / 音频。字节存在独立的媒体库里，角色卡只记 id，避免设置与存档被图片撑大。"
    >
      <div className="flex flex-wrap items-center gap-2">
        <label
          className="cursor-pointer px-3 py-2 text-xs font-serif tracking-wider transition-all hover:opacity-85"
          style={{
            color: 'rgba(var(--tj-text-primary), 0.86)',
            background: 'rgba(var(--tj-ui-panel-strong), 0.5)',
            border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))',
          }}
        >
          上传文件
          <input
            type="file"
            accept="image/*,audio/*"
            multiple
            className="hidden"
            onChange={(事件) => {
              void 处理上传(事件.target.files);
              事件.target.value = '';
            }}
          />
        </label>
        {占用 ? (
          <span className="text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.7)' }}>
            媒体库共 {占用.数量} 个 / {格式化字节(占用.总字节)}
          </span>
        ) : null}
      </div>

      {提示 ? <提示条 kind={提示.kind} text={提示.text} /> : null}

      {媒体列表.length === 0 ? (
        <提示条 kind="info" text="还没有媒体文件。" />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {媒体列表.map((项) => (
            <figure
              key={项.id}
              className="flex flex-col"
              style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))' }}
            >
              {项.用途 === 'audio' ? (
                <div
                  className="flex h-24 items-center justify-center text-2xl"
                  style={{ background: 'rgba(var(--tj-ui-panel-strong), 0.5)' }}
                >
                  ♪
                </div>
              ) : 预览[项.id] ? (
                <img src={预览[项.id]} alt={项.name} className="h-24 w-full object-cover" loading="lazy" />
              ) : (
                <div
                  className="flex h-24 items-center justify-center text-[11px]"
                  style={{ background: 'rgba(var(--tj-ui-panel-strong), 0.5)', color: 'rgba(var(--tj-text-secondary), 0.7)' }}
                >
                  无法预览
                </div>
              )}
              <figcaption
                className="flex items-center gap-1 px-1.5 py-1"
                style={{ background: 'rgba(var(--tj-ui-panel-strong), 0.35)' }}
              >
                <span
                  className="min-w-0 flex-1 truncate text-[11px]"
                  title={项.name}
                  style={{ color: 'rgba(var(--tj-text-secondary), 0.85)' }}
                >
                  {项.name}
                </span>
                <button
                  type="button"
                  onClick={() => void 处理删除(项)}
                  className="shrink-0 px-1 text-[11px] transition-all hover:opacity-80"
                  style={{ color: 'rgb(var(--tj-danger))' }}
                  title="删除"
                >
                  ×
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      <div className="text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.68)' }}>
        参考图作为出图输入的能力已在引擎侧就绪（`%comfyuicankaotupian%` 占位符 + `/upload/image`）。
        当前 ComfyUI 参考图上传开关在「总览」页。
      </div>
    </面板>
  );
}
