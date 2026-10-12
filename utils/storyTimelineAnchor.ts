
export function 提取绝对日期(text: string): [number, number, number] | undefined {
  const source = text.trim();
  if (!source) return undefined;
  const colon = /(\d{3,4}):(\d{1,2}):(\d{1,2})/.exec(source);
  if (colon) return 校验日期(colon);
  const dotted = /(\d{3,4})\.(\d{1,2})\.(\d{1,2})/.exec(source);
  return dotted ? 校验日期(dotted) : undefined;
}

function 校验日期(match: RegExpExecArray): [number, number, number] | undefined {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return [year, month, day];
}

export function 解析时间线锚点日(锚点文本: string, 当前日期文本: string, 当前游戏日: number): number | undefined {
  const anchor = 提取绝对日期(锚点文本);
  const current = 提取绝对日期(当前日期文本);
  if (!anchor || !current) return undefined;
  const ordinal = ([year, month, day]: [number, number, number]) => year * 372 + month * 31 + day;
  const delta = ordinal(anchor) - ordinal(current);
  return Math.max(1, Math.trunc(当前游戏日) + Math.max(0, delta));
}
