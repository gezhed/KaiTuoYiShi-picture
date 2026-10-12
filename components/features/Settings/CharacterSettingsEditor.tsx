import { useEffect, useRef, useState } from 'react';
import type { 角色卡, 服装条目 } from '@/models/genSystem';
import { 创建空角色部位字段, 角色部位字段名 } from '@/models/genSystem';
import { 追加标签串 } from '@/services/vocabulary/vocabulary';
import { CharacterMediaPanel } from './CharacterMediaPanel';
import { NovelAIReferencePanel } from './NovelAIReferencePanel';
import { CharacterPositionPanel } from './CharacterPositionPanel';
import { 主按钮, 面板, 提示条, 次级按钮, 开关行, 设置字段 as 字段 } from '@/components/features/Settings/settingsPrimitives';

/** 14 个部位字段的中文标签。 */
export const 部位字段标签: Record<typeof 角色部位字段名[number], string> = {
  nameCN: '中文名（| 分隔别名）',
  nameEN: '英文名（| 分隔别名）',
  characterTraits: '角色特征',
  facialFeatures: '面部特征（正面）',
  facialFeaturesBack: '面部特征（背面）',
  upperBodySFW: '上半身 SFW',
  upperBodySFWBack: '上半身 SFW（背面）',
  fullBodySFW: '下半身 SFW',
  fullBodySFWBack: '下半身 SFW（背面）',
  upperBodyNSFW: '上半身 NSFW',
  upperBodyNSFWBack: '上半身 NSFW（背面）',
  fullBodyNSFW: '下半身 NSFW',
  fullBodyNSFWBack: '下半身 NSFW（背面）',
  negative: '角色负面提示词',
};

const 分组: Array<{ title: string; 字段: Array<typeof 角色部位字段名[number]> }> = [
  { title: '身份', 字段: ['nameCN', 'nameEN', 'characterTraits'] },
  { title: '面部', 字段: ['facialFeatures', 'facialFeaturesBack'] },
  { title: '上半身', 字段: ['upperBodySFW', 'upperBodySFWBack', 'upperBodyNSFW', 'upperBodyNSFWBack'] },
  { title: '下半身', 字段: ['fullBodySFW', 'fullBodySFWBack', 'fullBodyNSFW', 'fullBodyNSFWBack'] },
  { title: '负面', 字段: ['negative'] },
];

export function 建角色卡(名称: string): 角色卡 {
  const 时间 = Date.now();
  return {
    ...创建空角色部位字段(),
    id: `char_${时间}_${Math.random().toString(36).slice(2, 8)}`,
    nameCN: 名称,
    enabled: true,
    aliases: [],
    outfits: [],
    selectedOutfitId: '',
    photoMedia: [],
    audioMedia: [],
    selectedPhotoId: '',
    selectedAudioId: '',
    photoPrompt: '',
    sendPhoto: false,
    参考组: { references: [], createdAt: 时间, updatedAt: 时间 },
    位置: null,
    createdAt: 时间,
    updatedAt: 时间,
  };
}

export function 建服装条目(名称: string): 服装条目 {
  return {
    id: `outfit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: 名称,
    上半身: '',
    下半身: '',
    全身: '',
    负面: '',
  };
}

export function CharacterSettingsEditor({
  角色,
  onChange,
  onDelete,
  onDuplicate,
  待追加,
  追加序号,
  on插入目标变更,
  参考模式,
  on参考模式变更,
  NovelAI模型,
}: {
  角色: 角色卡;
  onChange: (next: 角色卡) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  /** 由词库面板追加过来的标签串；`追加序号` 每来一次新串就自增一次。 */
  待追加?: string;
  追加序号?: number;
  /** 把「当前正在编辑哪个部位字段」告诉上层，供词库面板显示目标。 */
  on插入目标变更?: (字段标签: string) => void;
  /**
   * NovelAI 参考模式与模型是**全局**设置，不在角色卡上；
   * 由上层透传下来，仅用于参考组面板的模式切换与 Vibe 编码键提示。
   */
  参考模式?: 'character' | 'vibe';
  on参考模式变更?: (下一模式: 'character' | 'vibe') => void;
  NovelAI模型?: string;
}) {
  const [展开段, set展开段] = useState<string>('身份');
  // 词库面板追加时的落点：最后一个获得焦点的部位字段，默认落在「角色特征」。
  const 上次聚焦 = useRef<typeof 角色部位字段名[number]>('characterTraits');

  const 补丁 = (部分: Partial<角色卡>) => onChange({ ...角色, ...部分, updatedAt: Date.now() });

  // 追加串只在「序号变化」时消费一次；否则每次父组件重渲染都会把串重写进字段。
  useEffect(() => {
    if (!待追加 || !追加序号) return;
    const 字段 = 上次聚焦.current;
    补丁({ [字段]: 追加标签串(角色[字段], 待追加) } as Partial<角色卡>);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [追加序号]);

  const 补丁服装 = (服装Id: string, 部分: Partial<服装条目>) => {
    补丁({ outfits: 角色.outfits.map((项) => (项.id === 服装Id ? { ...项, ...部分 } : 项)) });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <次级按钮 active={角色.enabled} onClick={() => 补丁({ enabled: !角色.enabled })}>
          {角色.enabled ? '已启用' : '未启用'}
        </次级按钮>
        <次级按钮 onClick={onDuplicate}>复制一份</次级按钮>
        <次级按钮 onClick={onDelete}>删除</次级按钮>
      </div>

      <div className="px-2 py-1.5 text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.7)', border: '1px dashed rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))' }}>
        词库标签会追加到「{部位字段标签[上次聚焦.current]}」。点一下某个部位输入框再回「词库与标签」追加即可改落点。
      </div>

      {分组.map((组) => {
        const 展开 = 展开段 === 组.title;
        return (
          <div key={组.title} style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))' }}>
            <button
              type="button"
              onClick={() => set展开段(展开 ? '' : 组.title)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-all hover:opacity-80"
              style={{ color: 'rgba(var(--tj-text-primary), 0.88)' }}
            >
              <span className="font-serif tracking-[0.18em]">{组.title}</span>
              <span style={{ color: 'rgba(var(--tj-text-secondary), 0.6)' }}>{展开 ? '▲' : '▼'}</span>
            </button>
            {展开 ? (
              <div className="space-y-2 px-3 pb-3">
                {组.字段.map((键) => (
                  <字段 key={键} label={部位字段标签[键]}>
                    <textarea
                      className="kaituo-input h-16 w-full px-2 py-1.5 text-xs leading-relaxed"
                      value={角色[键]}
                      spellCheck={false}
                      onFocus={() => {
                        上次聚焦.current = 键;
                        on插入目标变更?.(部位字段标签[键]);
                      }}
                      onChange={(事件) => 补丁({ [键]: 事件.target.value } as Partial<角色卡>)}
                    />
                  </字段>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      <面板 title="服装" desc="`$服装名-upperbody-lowerbody$` 触发；不带 angle 的 JSON 形式也走服装。">
        <div className="flex flex-wrap gap-2">
          <次级按钮
            onClick={() => {
              const 新 = 建服装条目(`服装 ${角色.outfits.length + 1}`);
              补丁({ outfits: [...角色.outfits, 新], selectedOutfitId: 新.id });
            }}
          >
            新增服装
          </次级按钮>
        </div>
        {角色.outfits.length === 0 ? (
          <提示条 kind="info" text="还没有服装条目。" />
        ) : (
          <div className="space-y-2">
            {角色.outfits.map((服装) => (
              <div
                key={服装.id}
                className="space-y-2 px-2 py-2"
                style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))' }}
              >
                <div className="flex items-center gap-2">
                  <input
                    className="kaituo-input flex-1 px-2 py-1 text-xs"
                    value={服装.name}
                    onChange={(事件) => 补丁服装(服装.id, { name: 事件.target.value })}
                  />
                  <次级按钮
                    onClick={() => 补丁({
                      outfits: 角色.outfits.filter((项) => 项.id !== 服装.id),
                      selectedOutfitId: 角色.selectedOutfitId === 服装.id ? '' : 角色.selectedOutfitId,
                    })}
                  >
                    删除
                  </次级按钮>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {(['上半身', '下半身', '全身', '负面'] as const).map((键) => (
                    <字段 key={键} label={键}>
                      <input
                        className="kaituo-input w-full px-2 py-1 text-xs"
                        value={服装[键]}
                        onChange={(事件) => 补丁服装(服装.id, { [键]: 事件.target.value })}
                      />
                    </字段>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </面板>

      <NovelAIReferencePanel
        参考组={角色.参考组}
        媒体列表={[...角色.photoMedia, ...角色.audioMedia]}
        模式={参考模式 ?? 'character'}
        on模式变更={on参考模式变更 ?? (() => {})}
        模型={NovelAI模型 ?? ''}
        onChange={(下一组) => 补丁({ 参考组: 下一组 })}
      />

      <CharacterPositionPanel
        位置={角色.位置}
        onChange={(下一位置) => 补丁({ 位置: 下一位置 })}
      />

      <CharacterMediaPanel
        角色Id={角色.id}
        媒体列表={[...角色.photoMedia, ...角色.audioMedia]}
        onChange={(列表) => 补丁({
          photoMedia: 列表.filter((项) => 项.用途 !== 'audio'),
          audioMedia: 列表.filter((项) => 项.用途 === 'audio'),
        })}
      />

      <面板 title="生成与发送" desc="角色的照片提示词与出图后是否随消息发送。">
        <字段 label="照片提示词">
          <textarea
            className="kaituo-input h-16 w-full px-2 py-1.5 text-xs leading-relaxed"
            value={角色.photoPrompt}
            spellCheck={false}
            onChange={(事件) => 补丁({ photoPrompt: 事件.target.value })}
          />
        </字段>
        <开关行
          label="随消息发送照片"
          checked={角色.sendPhoto}
          onChange={(值) => 补丁({ sendPhoto: 值 })}
        />
      </面板>
    </div>
  );
}

/** 供列表页使用的轻量摘要。 */
export function 角色摘要(角色: 角色卡): string {
  const 别名 = [角色.nameCN, 角色.nameEN].filter(Boolean).join(' / ');
  return 别名 || 角色.id;
}

/** 供「新增」按钮使用的主按钮包装，避免调用方直接拼样式。 */
export function 新增角色按钮({ onClick }: { onClick: () => void }) {
  return <主按钮 onClick={onClick}>新建角色卡</主按钮>;
}
