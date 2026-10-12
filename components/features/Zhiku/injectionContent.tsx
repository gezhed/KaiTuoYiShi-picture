import { useMemo } from 'react';
import type { 智库分类, 智库注入内容 } from '@/models/zhiku';
import {
  创建空智库注入内容,
  归一化智库注入内容,
  ZHIKU_CHARACTER_INJECTION_FIELDS,
  ZHIKU_LORE_INJECTION_FIELDS,
} from '@/models/zhiku';
import { PerformanceTextarea, SectionLabel } from './fields';

interface InjectionContentFieldsProps {
  category: 智库分类;
  value?: 智库注入内容;
  editable: boolean;
  onChange: (next: 智库注入内容) => void;
}

function readField(content: 智库注入内容, field: string): string {
  const record = content as unknown as Record<string, string>;
  return typeof record[field] === 'string' ? record[field] : '';
}

export function InjectionContentFields({ category, value, editable, onChange }: InjectionContentFieldsProps) {
  /* 归一化会重新分配整个对象；工作台每敲一个字都会重渲这里，不能放在渲染体里裸跑。 */
  const normalized = useMemo(
    () => 归一化智库注入内容(value, category) ?? 创建空智库注入内容(category),
    [category, value],
  );
  if (!normalized) return null;
  const fields = normalized.类型 === 'character'
    ? ZHIKU_CHARACTER_INJECTION_FIELDS
    : ZHIKU_LORE_INJECTION_FIELDS;

  return (
    <section className="zk-section">
      <SectionLabel>注入内容</SectionLabel>
      <p className="zk-note" style={{ marginBottom: 12 }}>
        结构化注入是召回时真正送给模型的内容；任一字段为空，该条目都不会参与主剧情注入。
      </p>
      <div className="zk-grid">
        {fields.map((field) => (
          <PerformanceTextarea
            key={field}
            label={field}
            value={readField(normalized, field)}
            editable={editable}
            onChange={(next) => onChange({ ...normalized, [field]: next })}
          />
        ))}
      </div>
    </section>
  );
}
