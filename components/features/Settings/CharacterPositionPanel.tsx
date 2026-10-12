import type { 角色位置 } from '@/models/genSystem';
import {
  网格列,
  网格行,
  建网格位置,
  建数值位置,
  描述位置,
} from '@/services/ai/imageGen/characterPosition';
import { 面板, 提示条, 次级按钮, 设置字段 as 字段 } from '@/components/features/Settings/settingsPrimitives';

/**
 * 角色位置编辑器。
 *
 * 上游**没有**这个控件（规格书 §1.4：坐标只由模型在提示词里写 `centers:c3`
 * 再被解析）。这里补上，让位置成为玩家可固定的角色属性；不设时仍然交给模型决定，
 * 与上游默认行为一致。
 */
export function CharacterPositionPanel({
  位置,
  onChange,
}: {
  位置: 角色位置 | null;
  onChange: (下一位置: 角色位置 | null) => void;
}) {
  const 当前网格 = 位置?.mode === 'grid' ? 位置.grid : undefined;

  return (
    <面板
      title="角色位置"
      desc="多角色同框时，指定这个角色落在画面哪一块。只对 NovelAI 的分角色载荷生效。"
    >
      <div className="flex flex-wrap items-center gap-2">
        <次级按钮 active={位置 === null} onClick={() => onChange(null)}>交给模型决定</次级按钮>
        <span className="text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.8)' }}>
          当前：{描述位置(位置)}
        </span>
      </div>

      <字段 label="5×5 网格" hint="点格子即定位。只在 NovelAI 分角色模式下有意义。">
        <div className="inline-grid grid-cols-5 gap-1">
          {网格行.map((行) => 网格列.map((列) => {
            const 标记 = `${列}${行}`;
            const 选中 = 当前网格 === 标记;
            return (
              <button
                key={标记}
                type="button"
                onClick={() => onChange(建网格位置(标记))}
                className="h-8 w-8 text-[10px] font-mono transition-all hover:opacity-85"
                style={{
                  color: 选中 ? 'rgb(var(--tj-ui-active-text))' : 'rgba(var(--tj-text-secondary), 0.85)',
                  background: 选中
                    ? 'linear-gradient(135deg, rgba(var(--tj-btn-primary-start),0.9), rgba(var(--tj-btn-primary-end),0.78))'
                    : 'rgba(var(--tj-ui-panel-strong), 0.45)',
                  border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))',
                }}
                title={标记}
              >
                {标记}
              </button>
            );
          }))}
        </div>
      </字段>

      <div className="grid gap-3 md:grid-cols-2">
        <字段 label="横向 (x)" hint="0 = 最左，1 = 最右。">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={位置?.x ?? 0.5}
            className="w-full"
            onChange={(事件) => onChange(建数值位置(Number(事件.target.value), 位置?.y ?? 0.5))}
          />
          <div className="text-[11px] font-mono" style={{ color: 'rgba(var(--tj-text-secondary), 0.8)' }}>
            {(位置?.x ?? 0.5).toFixed(2)}
          </div>
        </字段>
        <字段 label="纵向 (y)" hint="0 = 最上，1 = 最下。">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={位置?.y ?? 0.5}
            className="w-full"
            onChange={(事件) => onChange(建数值位置(位置?.x ?? 0.5, Number(事件.target.value)))}
          />
          <div className="text-[11px] font-mono" style={{ color: 'rgba(var(--tj-text-secondary), 0.8)' }}>
            {(位置?.y ?? 0.5).toFixed(2)}
          </div>
        </字段>
      </div>

      <提示条
        kind="info"
        text="拖到网格点上会自动吸附成网格标记；停在网格之间则保留为数值坐标（不会被硬凑到最近的格子）。"
      />
    </面板>
  );
}
