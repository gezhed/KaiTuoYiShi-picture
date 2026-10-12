import { useMemo, type ReactNode } from 'react';
import { marked } from 'marked';

/* 预设原文用的是「章节名独占一行 + 段落」的固定写法，不是通用 markdown。
   这份表是照着 162 条内置资料的层结构拟的，改动前先确认预设原文没换写法。 */
const SECTION_HEADINGS = new Set([
  '基础识别',
  '角色详情',
  '常驻事实层',
  '角色故事',
  '角色故事层',
  '表现锚点层',
  '语料层',
  '写法指导',
  '语料参考',
  '能力与职责模块',
  '人物概要',
  '关系与知情边界',
  '事实边界',
  '本回合注入建议',
  '关键事件',
  '时间线',
  '角色档案',
  '势力档案',
  '地图地点档案',
]);

const VOICE_LINE_PATTERN = /^(#{2,4})\s+(.+?)(?:\s*[：:])?\s+([「『“"].*)$/u;

function preprocessSource(raw: string): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const processed: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      processed.push('');
      continue;
    }

    // 1. 特殊语音台词处理：例如 `### 初次见面 「...」` 或 `### 问候 ： 「...」`
    // 拆成标题和台词正文，避免将整段引言塞在标题标签内
    const voiceMatch = trimmed.match(VOICE_LINE_PATTERN);
    if (voiceMatch) {
      processed.push(`\n${voiceMatch[1]} ${voiceMatch[2].trim()}\n\n${voiceMatch[3].trim()}\n`);
      continue;
    }

    // 2. 纯文本章节标题标准化（无 # 的章节名）：如 `基础识别`、`角色详情`、`常驻事实层`
    const cleanHeading = trimmed.replace(/：$/u, '');
    if (SECTION_HEADINGS.has(cleanHeading) || SECTION_HEADINGS.has(trimmed)) {
      processed.push(`\n### ${cleanHeading}\n`);
      continue;
    }

    // 3. Markdown 标题标准化：确保标题前后有空行，防止在单行换行时被识别为普通段落文本
    const mdHeadingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/u);
    if (mdHeadingMatch) {
      processed.push(`\n${mdHeadingMatch[1]} ${mdHeadingMatch[2].trim()}\n`);
      continue;
    }

    processed.push(line);
  }

  return processed.join('\n');
}

export interface ProseProps {
  source: string;
  footer?: ReactNode;
}

export function Prose({ source, footer }: ProseProps) {
  const trimmed = source.trim();

  const html = useMemo(() => {
    if (!trimmed) return '';
    const preprocessed = preprocessSource(trimmed);
    return marked.parse(preprocessed, { gfm: true, breaks: true }) as string;
  }, [trimmed]);

  if (!trimmed) {
    return (
      <div className="zk-prose">
        <p style={{ color: 'var(--zk-faint)' }}>该档案暂无可阅读正文。</p>
      </div>
    );
  }

  return (
    <div className="zk-prose">
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {footer}
    </div>
  );
}
