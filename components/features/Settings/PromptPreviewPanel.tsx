import { useMemo, useState } from 'react';
import type { 文生图系统设置 } from '@/models/genSystem';
import { 生成提示词预览 } from '@/services/ai/imageGen/promptPreview';
import { 默认插图标记 } from '@/services/ai/imageGen/illustrationProtocol';
import { 面板, 提示条, 次级按钮, 设置字段 as 字段 } from '@/components/features/Settings/settingsPrimitives';

/**
 * 提示词装配预览。
 *
 * 移植中最容易出错的三步——角色 `$…$` 替换、替换规则、尺寸剥离——在别处
 * 只有发一次请求、看服务端回的图才能确认。这里把它们摊开，本地即可核对，
 * 不必消耗额度，也不必猜。
 */
export function PromptPreviewPanel({
  系统,
  角色上下文,
}: {
  系统: 文生图系统设置;
  角色上下文: import('@/services/ai/imageGen/characterPrompt').角色匹配上下文;
}) {
  const 示例 = `${默认插图标记}1girl, solo, 银发, 站在窗前###`;
  const [输入, set输入] = useState(示例);
  const [提交的, set提交的] = useState(示例);

  const 预览 = useMemo(
    () => 生成提示词预览(系统, 提交的, 角色上下文),
    [系统, 提交的, 角色上下文],
  );

  const 复制 = async (文本: string) => {
    try {
      await navigator.clipboard.writeText(文本);
    } catch {
      // 剪贴板不可用时不打断流程；用户可以手动选中复制。
    }
  };

  return (
    <面板
      title="提示词预览"
      desc="把「剥尺寸 → 角色替换 → 替换规则 → 组装正负词」的每一步摊开。不发任何请求。"
    >
      <字段 label="示例提示词标记" hint={`外壳默认是 ${默认插图标记}…###，可以整段贴进来试。`}>
        <textarea
          className="kaituo-input h-20 w-full px-2 py-1.5 text-xs font-mono leading-relaxed"
          value={输入}
          spellCheck={false}
          onChange={(事件) => set输入(事件.target.value)}
        />
      </字段>
      <div className="flex flex-wrap gap-2">
        <次级按钮 onClick={() => set提交的(输入)}>预览</次级按钮>
        <次级按钮 onClick={() => { set输入(示例); set提交的(示例); }}>恢复示例</次级按钮>
      </div>

      {预览.错误 ? <提示条 kind="error" text={预览.错误} /> : null}

      <div className="grid gap-3 md:grid-cols-2">
        <字段 label="① 剥掉标记外壳">
          <div className="kaituo-input max-h-24 overflow-auto px-2 py-1.5 text-[11px] font-mono leading-relaxed">
            {预览.提示词正文 || '（空）'}
          </div>
        </字段>
        <字段 label="② 角色替换后">
          <div className="kaituo-input max-h-24 overflow-auto px-2 py-1.5 text-[11px] font-mono leading-relaxed">
            {预览.角色替换后 || '（空）'}
          </div>
        </字段>
      </div>

      <字段 label="③ 替换规则应用后的主体提示词">
        <div className="kaituo-input max-h-28 overflow-auto px-2 py-1.5 text-[11px] font-mono leading-relaxed">
          {预览.主体提示词 || '（空）'}
        </div>
      </字段>

      <字段 label={`④ 最终正向提示词（预设：${预览.预设名称 || '无'}）`}>
        <div className="kaituo-input max-h-32 overflow-auto px-2 py-1.5 text-[11px] font-mono leading-relaxed">
          {预览.正向提示词 || '（空）'}
        </div>
        <次级按钮 onClick={() => void 复制(预览.正向提示词)} disabled={!预览.正向提示词}>复制</次级按钮>
      </字段>

      <字段 label="⑤ 最终负向提示词">
        <div className="kaituo-input max-h-24 overflow-auto px-2 py-1.5 text-[11px] font-mono leading-relaxed">
          {预览.负向提示词 || '（空）'}
        </div>
        <次级按钮 onClick={() => void 复制(预览.负向提示词)} disabled={!预览.负向提示词}>复制</次级按钮>
      </字段>

      <字段 label="尺寸解析">
        <div className="text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.85)' }}>
          自主分辨率：<strong>{预览.自主分辨率 ? '开启' : '关闭'}</strong>
          {'　'}剥出尺寸：
          <strong>
            {预览.宽度 && 预览.高度 ? `${预览.宽度}×${预览.高度}` : '未剥出（用渠道默认尺寸）'}
          </strong>
          {!预览.自主分辨率 ? '　— 关闭时提示词里的 WxH 不会被识别。' : ''}
        </div>
      </字段>

      {预览.命中角色.length > 0 ? (
        <字段 label={`命中的角色（${预览.命中角色.length}）`}>
          <div className="space-y-1">
            {预览.命中角色.map((项, 序号) => (
              <div
                key={`${项.名称}-${序号}`}
                className="px-2 py-1 text-[11px] leading-relaxed"
                style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))' }}
              >
                <span className="font-serif">{项.名称}</span>
                <span className="ml-2" style={{ color: 'rgba(var(--tj-text-secondary), 0.75)' }}>
                  位置 {项.位置}
                </span>
                <div className="mt-0.5 font-mono" style={{ color: 'rgba(var(--tj-text-secondary), 0.85)' }}>
                  {项.提示词 || '（该角色的部位字段都是空的）'}
                </div>
              </div>
            ))}
          </div>
        </字段>
      ) : (
        <提示条
          kind="info"
          text="没有命中任何角色。写成 $角色名-sfw-upperbody$ 才会触发角色替换；名字要与角色卡的「中文名/英文名/别名」之一匹配。"
        />
      )}

      {预览.角色负面 ? (
        <提示条 kind="info" text={`角色带出的负面词：${预览.角色负面}`} />
      ) : null}
    </面板>
  );
}
