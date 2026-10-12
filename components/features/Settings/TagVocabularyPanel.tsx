import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  安装词库,
  卸载词库,
  列出已装词库,
  读取词库内容,
  统计词库,
  清空词库,
} from '@/services/vocabulary/vocabularyStore';
import { 解密词库文本 } from '@/services/vocabulary/decrypt';
import {
  建检索索引,
  检索词条,
  组装标签串,
  上游词库文件名,
  type 检索条目,
  type 词条排序,
} from '@/services/vocabulary/vocabulary';
import type { 已装词库 } from '@/models/genSystem';
import { 面板, 提示条, 次级按钮, 设置字段 as 字段 } from './settingsPrimitives';

type 提示 = { kind: 'info' | 'ok' | 'error'; text: string } | null;

/**
 * 词库与标签编辑器。
 *
 * 导入的是上游 `tagData/*.json` —— 那些文件是 base64 的 OpenSSL 口令模式密文
 * （口令硬编码在上游 index.js L93662）。解密后落进本应用自己的 IndexedDB。
 *
 * 与上游的差异：上游检索靠 `openCursor` 全表扫；这里把词条读进内存建检索索引，
 * 一次读库、多次检索，49,000 条量级下打字几乎无延迟。
 */
export function TagVocabularyPanel({ on追加 }: { on追加?: (标签串: string) => void }) {
  const [已装, set已装] = useState<已装词库[]>([]);
  const [统计, set统计] = useState<{ 词条数: number; 词库数: number }>({ 词条数: 0, 词库数: 0 });
  const [索引词条, set索引词条] = useState<检索条目[]>([]);
  const [提示, set提示] = useState<提示>(null);
  const [导入中, set导入中] = useState(false);
  const [构建中, set构建中] = useState(false);

  const [关键词, set关键词] = useState('');
  const [前缀匹配, set前缀匹配] = useState(false);
  const [排序, set排序] = useState<词条排序>('hot_desc');
  const [上限, set上限] = useState(60);
  const [选中的, set选中的] = useState<Array<{ name: string; translation?: string }>>([]);
  const [自填名, set自填名] = useState('');
  const [自填译文, set自填译文] = useState('');
  const 文件输入 = useRef<HTMLInputElement | null>(null);

  const 刷新清单 = useCallback(async () => {
    const [列表, 汇总] = await Promise.all([列出已装词库(), 统计词库()]);
    set已装(列表);
    set统计(汇总);
  }, []);

  useEffect(() => {
    void 刷新清单().catch((错误) => {
      set提示({ kind: 'error', text: `读取词库清单失败：${错误 instanceof Error ? 错误.message : String(错误)}` });
    });
  }, [刷新清单]);

  const 重建索引 = useCallback(async () => {
    set构建中(true);
    try {
      const 内容 = await 读取词库内容();
      set索引词条(建检索索引(内容.词条));
    } finally {
      set构建中(false);
    }
  }, []);

  // 词条数变化说明装/卸过词库，索引需要重建。
  useEffect(() => {
    if (统计.词条数 === 0) {
      set索引词条([]);
      return;
    }
    void 重建索引();
  }, [统计.词条数, 重建索引]);

  const 检索结果 = useMemo(() => {
    if (!关键词.trim() || 索引词条.length === 0) return [];
    return 检索词条(索引词条, 关键词, { startsWith: 前缀匹配, sortBy: 排序, limit: 上限 });
  }, [关键词, 索引词条, 前缀匹配, 排序, 上限]);

  const 组合串 = useMemo(() => 组装标签串(选中的), [选中的]);

  const 处理导入 = async (文件: FileList | null) => {
    if (!文件 || 文件.length === 0) return;
    set导入中(true);
    set提示({ kind: 'info', text: `正在解密并导入 ${文件.length} 个词库文件…` });
    const 成功: string[] = [];
    const 失败: string[] = [];
    for (const 单个 of Array.from(文件)) {
      try {
        const 字节 = new Uint8Array(await 单个.arrayBuffer());
        const { 数据 } = await 解密词库文本(字节);
        const 结果 = await 安装词库(单个.name, 数据);
        成功.push(`${结果.文件名}（${结果.词条数} 条${结果.分层 ? '，分层' : ''}）`);
      } catch (错误) {
        失败.push(`${单个.name}：${错误 instanceof Error ? 错误.message : String(错误)}`);
      }
    }
    await 刷新清单();
    set导入中(false);
    if (失败.length === 0) {
      set提示({ kind: 'ok', text: `导入完成：\n${成功.join('\n')}` });
    } else {
      set提示({
        kind: 成功.length > 0 ? 'info' : 'error',
        text: `成功 ${成功.length} 个，失败 ${失败.length} 个：\n${失败.join('\n')}`,
      });
    }
  };

  const 处理卸载 = async (文件名: string) => {
    await 卸载词库(文件名);
    await 刷新清单();
    set提示({ kind: 'info', text: `已卸载 ${文件名}。` });
  };

  const 处理清空 = async () => {
    await 清空词库();
    await 刷新清单();
    set提示({ kind: 'ok', text: '已清空全部词库。' });
  };

  const 复制组合串 = async () => {
    try {
      await navigator.clipboard.writeText(组合串);
      set提示({ kind: 'ok', text: '标签串已复制到剪贴板。' });
    } catch (错误) {
      set提示({ kind: 'error', text: `复制失败：${错误 instanceof Error ? 错误.message : String(错误)}` });
    }
  };

  return (
    <div className="space-y-4">
      <面板
        title="词库"
        desc="导入 st-chatu8 的 tagData 文件（base64 密文，解密依赖上游硬编码口令）。25 个 danbooru 文件 + tags.json + tag_NSFW001.json。"
      >
        <div className="flex flex-wrap items-center gap-2">
          <次级按钮 onClick={() => 文件输入.current?.click()} disabled={导入中}>
            {导入中 ? '导入中…' : '导入词库文件'}
          </次级按钮>
          <次级按钮 onClick={() => void 重建索引()} disabled={构建中 || 统计.词条数 === 0}>
            {构建中 ? '建索引中…' : '重建检索索引'}
          </次级按钮>
          <次级按钮 onClick={() => void 处理清空()} disabled={统计.词库数 === 0}>清空全部</次级按钮>
        </div>
        <input
          ref={文件输入}
          type="file"
          accept="application/json,.json"
          multiple
          className="hidden"
          onChange={(事件) => void 处理导入(事件.target.files)}
        />
        <提示条
          kind="info"
          text={`已装 ${统计.词库数} 个词库 / ${统计.词条数} 条词条；内存检索索引 ${索引词条.length} 条。`
            + (统计.词条数 > 0 && 索引词条.length === 0 ? '（索引为空，点「重建检索索引」）' : '')}
        />
        {已装.length > 0 ? (
          <div className="space-y-1">
            {已装.map((项) => (
              <div
                key={项.fileName}
                className="flex items-center gap-2 px-2 py-1 text-xs"
                style={{ border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))' }}
              >
                <span className="min-w-0 flex-1 truncate font-mono" style={{ color: 'rgba(var(--tj-text-primary), 0.86)' }}>
                  {项.fileName}
                </span>
                <span style={{ color: 'rgba(var(--tj-text-secondary), 0.7)' }}>{项.tagCount} 条</span>
                <次级按钮 onClick={() => void 处理卸载(项.fileName)}>卸载</次级按钮>
              </div>
            ))}
          </div>
        ) : (
          <提示条 kind="info" text={`还没有词库。点「导入词库文件」选择 ${上游词库文件名[0]} 等文件。`} />
        )}
        {提示 ? <提示条 kind={提示.kind} text={提示.text} /> : null}
      </面板>

      <面板 title="检索与选词" desc="命中名称或译文即列出；热度未知（分层词库）的条目排在最前。">
        <div className="grid gap-3 md:grid-cols-3">
          <字段 label="关键词">
            <input
              className="kaituo-input w-full px-3 py-2 text-sm"
              value={关键词}
              onChange={(事件) => set关键词(事件.target.value)}
              placeholder="1girl / 女孩"
            />
          </字段>
          <字段 label="排序">
            <select
              className="kaituo-input w-full px-3 py-2 text-sm"
              value={排序}
              onChange={(事件) => set排序(事件.target.value as 词条排序)}
            >
              <option value="hot_desc">热度降序</option>
              <option value="hot_asc">热度升序</option>
              <option value="key_asc">名称字典序</option>
            </select>
          </字段>
          <字段 label="上限">
            <input
              type="number"
              min={1}
              max={500}
              className="kaituo-input w-full px-3 py-2 text-sm"
              value={上限}
              onChange={(事件) => set上限(Math.max(1, Math.min(500, Number(事件.target.value) || 60)))}
            />
          </字段>
        </div>
        <div className="flex flex-wrap gap-2">
          <次级按钮 active={前缀匹配} onClick={() => set前缀匹配((值) => !值)}>
            {前缀匹配 ? '仅匹配开头' : '任意位置匹配'}
          </次级按钮>
        </div>

        {关键词.trim() && 索引词条.length === 0 ? (
          <提示条 kind="info" text="还没有检索索引。先导入词库再点「重建检索索引」。" />
        ) : null}

        {检索结果.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {检索结果.map((项) => (
              <button
                key={项.name}
                type="button"
                onClick={() => set选中的((当前) => [...当前, { name: 项.name, translation: 项.translation }])}
                className="px-2 py-1 text-[11px] transition-all hover:opacity-85"
                style={{
                  color: 'rgba(var(--tj-text-primary), 0.88)',
                  background: 'rgba(var(--tj-ui-panel-strong), 0.5)',
                  border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))',
                }}
                title={项.translation || 项.name}
              >
                <span className="font-mono">{项.name}</span>
                {项.translation ? <span className="ml-1 opacity-70">{项.translation}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </面板>

      <面板 title="手动添加" desc="词库里没有的标签可以手填；译文可留空。">
        <div className="grid gap-3 md:grid-cols-2">
          <字段 label="名称">
            <input
              className="kaituo-input w-full px-3 py-2 text-sm font-mono"
              value={自填名}
              onChange={(事件) => set自填名(事件.target.value)}
              placeholder="my_custom_tag"
            />
          </字段>
          <字段 label="译文（可空）">
            <input
              className="kaituo-input w-full px-3 py-2 text-sm"
              value={自填译文}
              onChange={(事件) => set自填译文(事件.target.value)}
            />
          </字段>
        </div>
        <次级按钮
          disabled={!自填名.trim()}
          onClick={() => {
            set选中的((当前) => [...当前, { name: 自填名.trim(), translation: 自填译文.trim() || undefined }]);
            set自填名('');
            set自填译文('');
          }}
        >
          加入已选
        </次级按钮>
      </面板>

      <面板 title={`已选标签（${选中的.length}）`} desc="组装成标签串时会去重，同名标签优先保留带权重的那一份。">
        <div className="flex flex-wrap gap-2">
          <次级按钮
            onClick={() => set选中的((当前) => [...当前].reverse())}
            disabled={选中的.length < 2}
          >
            反转顺序
          </次级按钮>
          <次级按钮 onClick={() => set选中的([])} disabled={选中的.length === 0}>清空已选</次级按钮>
          <次级按钮 onClick={() => void 复制组合串()} disabled={!组合串}>复制标签串</次级按钮>
          {on追加 ? (
            <次级按钮
              onClick={() => {
                on追加(组合串);
                set提示({ kind: 'ok', text: '已把标签串追加到角色字段。' });
              }}
              disabled={!组合串}
            >
              追加到目标字段
            </次级按钮>
          ) : null}
        </div>

        {选中的.length === 0 ? (
          <提示条 kind="info" text="还没有选中标签。上面检索后点标签即可加入。" />
        ) : (
          <div className="flex flex-wrap gap-1">
            {选中的.map((项, 序号) => (
              <button
                key={`${项.name}-${序号}`}
                type="button"
                onClick={() => set选中的((当前) => 当前.filter((_项, 下标) => 下标 !== 序号))}
                className="px-2 py-1 text-[11px] transition-all hover:opacity-85"
                style={{
                  color: 'rgb(var(--tj-ui-active-text))',
                  background: 'linear-gradient(135deg, rgba(var(--tj-btn-primary-start),0.9), rgba(var(--tj-btn-primary-end),0.78))',
                  border: '1px solid rgba(var(--tj-text-primary), var(--tj-edge-weak))',
                }}
                title="点击移除"
              >
                <span className="font-mono">{项.name}</span>
                {项.translation ? <span className="ml-1 opacity-80">{项.translation}</span> : null}
                <span className="ml-1 font-bold">×</span>
              </button>
            ))}
          </div>
        )}

        <字段 label="标签串预览" hint="`$…$` 角色触发段会被完整保护，段内逗号不参与切分。">
          <textarea
            className="kaituo-input h-20 w-full px-2 py-1.5 text-xs font-mono leading-relaxed"
            value={组合串}
            readOnly
            spellCheck={false}
          />
        </字段>
      </面板>
    </div>
  );
}
