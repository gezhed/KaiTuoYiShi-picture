import type { 游戏设置, VisualTextSettings } from '@/models/settings';
import { 创建默认视觉文本设置, 归一化视觉文本设置 } from '@/models/settings';
import { cardClip, mediumClip, smallClip } from '@/components/ui/clipPaths';
import { 开关行 } from '@/components/features/Settings/settingsPrimitives';

interface Props {
  settings: 游戏设置;
  onChange: (settings: 游戏设置) => void;
}


const RANGE_MIN = 13;
const RANGE_MAX = 30;

export function VisualSettingsTab({ settings, onChange }: Props) {
  const visual = 归一化视觉文本设置(settings.visualTextSettings);
  const 逐段 = settings.逐句推进 ?? { 启用: false, 立即全显: false };

  const update = (patch: Partial<VisualTextSettings>) => {
    onChange({
      ...settings,
      visualTextSettings: 归一化视觉文本设置({ ...visual, ...patch }),
    });
  };

  const 更新逐段 = (patch: Partial<游戏设置['逐句推进']>) => {
    onChange({ ...settings, 逐句推进: { ...逐段, ...patch } });
  };

  const reset = () => {
    onChange({
      ...settings,
      visualTextSettings: 创建默认视觉文本设置(),
    });
  };

  return (
    <div className="space-y-5">
      <section
        className="px-4 py-4"
        style={{
          background: 'rgba(var(--tj-bg-secondary), 0.42)',
          border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))',
          clipPath: mediumClip,
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-serif text-sm font-bold tracking-[0.24em]" style={{ color: 'rgb(var(--tj-accent-primary))' }}>
              正文字号
            </h3>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.72)' }}>
              只调整主聊天正文显示，不影响按钮、面板、变量记录、图片卡片和其他系统 UI。
            </p>
          </div>
          <button
            type="button"
            onClick={reset}
            className="px-3 py-1.5 font-serif text-xs tracking-[0.18em] transition-all hover:opacity-90"
            style={{
              color: 'rgba(var(--tj-accent-primary), 0.92)',
              background: 'rgba(var(--tj-accent-primary), 0.06)',
              border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))',
              clipPath: smallClip,
            }}
          >
            恢复默认
          </button>
        </div>
      </section>

      <div className="grid gap-3">
        <FontSizeSlider
          label="旁白正文"
          desc="用于环境描写、动作描写和未标注为角色台词的正文。"
          value={visual.narrationFontSize}
          onChange={(value) => update({ narrationFontSize: value })}
        />
        <FontSizeSlider
          label="角色台词"
          desc="用于 NPC 对话气泡和心声段落。"
          value={visual.dialogueFontSize}
          onChange={(value) => update({ dialogueFontSize: value })}
        />
        <FontSizeSlider
          label="玩家发言"
          desc="用于玩家输入气泡，以及正文中被识别为旅人发言的台词。"
          value={visual.playerFontSize}
          onChange={(value) => update({ playerFontSize: value })}
        />
      </div>

      <section
        className="px-4 py-4"
        style={{
          background: 'rgba(var(--tj-bg-secondary), 0.45)',
          border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))',
          clipPath: mediumClip,
        }}
      >
        <h3 className="font-serif text-sm font-bold tracking-[0.24em]" style={{ color: 'rgb(var(--tj-accent-primary))' }}>
          galgame 模式
        </h3>
        <p className="mt-1 mb-3 text-xs leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.72)' }}>
          正文一次只显示<span style={{ color: 'rgb(var(--tj-accent-primary))' }}>一段</span>，前进时上一段消失：滚轮向下、空格或回车前进，滚轮向上回退一段。
          段落按正文空行划分，所以对白和它前后的旁白会一起出现，不会被拆开。
          生成过程中自动全显，不打断阅读。
        </p>
        <开关行
          label="启用 galgame 模式"
          desc="只影响正文的显示方式（逐段推进），不改动内容，也不影响存档、变量与后续发送给模型的文本。"
          checked={逐段.启用}
          onChange={(值) => 更新逐段({ 启用: 值 })}
        />
        <开关行
          label="新回合立即全显"
          desc="保留逐段交互的入口，但每次新正文直接整段铺开，适合想一次读完的场景。"
          checked={逐段.立即全显}
          onChange={(值) => 更新逐段({ 立即全显: 值 })}
        />
      </section>

      <section
        className="px-4 py-4"
        style={{
          background: 'rgba(var(--tj-bg-primary), 0.26)',
          border: '1px solid rgba(var(--tj-border), var(--tj-edge-weak))',
          clipPath: mediumClip,
        }}
      >
        <div className="mb-3 font-serif text-xs tracking-[0.24em]" style={{ color: 'rgb(var(--tj-accent-primary))' }}>
          预览
        </div>
        <div className="space-y-3">
          <div
            className="px-4 py-2.5"
            style={{
              background: 'rgba(var(--tj-accent-primary), 0.018)',
              borderLeft: '2px solid rgba(var(--tj-accent-primary), 0.34)',
              borderRight: '1px solid rgba(var(--tj-border), 0.24)',
            }}
          >
            <p style={{ color: 'rgba(var(--tj-chat-text), 0.94)', fontSize: `${visual.narrationFontSize}px`, lineHeight: 1.8 }}>
              观景车厢外掠过一束冷白色星光，杯沿的热雾在灯下慢慢舒展开。
            </p>
          </div>
          <div
            className="px-4 py-3"
            style={{
              color: 'rgba(var(--tj-chat-text), 0.96)',
              background: 'rgba(var(--tj-chat-bubble), var(--tj-chat-bubble-alpha, 0.78))',
              border: '1px solid rgba(140, 195, 230, var(--tj-edge-tint-strong))',
              clipPath: cardClip,
            }}
          >
            <p style={{ fontSize: `${visual.dialogueFontSize}px`, lineHeight: 1.8 }}>
              三月七：这个大小看起来舒服吗？要是还小，我们就再调大一点。
            </p>
          </div>
          <div className="flex justify-end">
            <div
              className="max-w-[86%] px-4 py-2.5"
              style={{
                color: 'rgba(var(--tj-chat-text), 0.98)',
                background: 'rgba(var(--tj-chat-bubble), var(--tj-chat-bubble-alpha, 0.78))',
                border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-strong))',
                clipPath: cardClip,
                fontWeight: 600,
              }}
            >
              <p style={{ fontSize: `${visual.playerFontSize}px`, lineHeight: 1.8 }}>
                我想让正文再清楚一点。
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function FontSizeSlider({
  label,
  desc,
  value,
  onChange,
}: {
  label: string;
  desc: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <section
      className="px-4 py-3"
      style={{
        background: 'rgba(var(--tj-bg-secondary), 0.45)',
        border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))',
        clipPath: smallClip,
      }}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-serif text-sm font-bold tracking-[0.16em]" style={{ color: 'rgb(var(--tj-text-primary))' }}>
            {label}
          </div>
          <div className="mt-0.5 text-xs leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.66)' }}>
            {desc}
          </div>
        </div>
        <span className="shrink-0 font-mono text-sm font-bold" style={{ color: 'linear-gradient(135deg, rgba(var(--tj-accent-primary),0.94), rgba(var(--tj-accent-secondary),0.9))' }}>
          {value}px
        </span>
      </div>
      <input
        type="range"
        min={RANGE_MIN}
        max={RANGE_MAX}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-[rgb(var(--tj-accent-primary))]"
      />
      <div className="mt-1 flex justify-between text-[10px] font-mono" style={{ color: 'rgba(var(--tj-text-secondary), 0.52)' }}>
        <span>{RANGE_MIN}px</span>
        <span>{RANGE_MAX}px</span>
      </div>
    </section>
  );
}
