export type 天气类型 =
  | 'clear'
  | 'cloudy'
  | 'overcast'
  | 'light_rain'
  | 'heavy_rain'
  | 'snow'
  | 'blizzard'
  | 'star_dust_storm'
  | 'rift_wind'
  | 'ether_fog'
  | 'aurora'
  | 'energy_rain'
  | 'data_storm'
  | 'star_tide';

export interface 天气定义 {
  id: 天气类型;
  name: string;
  emoji: string;
  particle: string | null;
  category: '基础' | '降水' | '科幻' | '特殊';
}

export const 天气列表: 天气定义[] = [
  { id: 'clear', name: '晴', emoji: '☀️', particle: 'spark', category: '基础' },
  { id: 'cloudy', name: '多云', emoji: '⛅', particle: null, category: '基础' },
  { id: 'overcast', name: '阴', emoji: '☁️', particle: 'dim', category: '基础' },
  { id: 'light_rain', name: '小雨', emoji: '🌧️', particle: 'rain', category: '降水' },
  { id: 'heavy_rain', name: '大雨', emoji: '⛈️', particle: 'heavy_rain', category: '降水' },
  { id: 'snow', name: '雪', emoji: '❄️', particle: 'snow', category: '降水' },
  { id: 'blizzard', name: '暴风雪', emoji: '🌨️', particle: 'blizzard', category: '降水' },
  { id: 'star_dust_storm', name: '星尘暴', emoji: '🌌', particle: 'star_dust', category: '科幻' },
  { id: 'rift_wind', name: '裂隙风', emoji: '💨', particle: 'rift_wind', category: '科幻' },
  { id: 'ether_fog', name: '以太雾', emoji: '🌫️', particle: 'ether_fog', category: '科幻' },
  { id: 'aurora', name: '极光', emoji: '🌠', particle: 'aurora', category: '科幻' },
  { id: 'energy_rain', name: '能量雨', emoji: '💠', particle: 'energy_rain', category: '科幻' },
  { id: 'data_storm', name: '数据风暴', emoji: '🌀', particle: 'data_storm', category: '特殊' },
  { id: 'star_tide', name: '星海潮汐', emoji: '🌊', particle: 'star_tide', category: '特殊' },
];

export const 天气名映射: Record<string, string> = {};
export const 天气Emoji映射: Record<string, string> = {};
for (const w of 天气列表) {
  天气名映射[w.id] = w.name;
  天气Emoji映射[w.id] = w.emoji;
}

const 地点天气白名单: Record<string, 天气类型[]> = {
  '雅利洛': ['clear', 'cloudy', 'overcast', 'snow', 'blizzard', 'aurora', 'ether_fog'],
  '贝洛伯格': ['clear', 'cloudy', 'overcast', 'snow', 'blizzard', 'ether_fog'],
  '永冬': ['clear', 'overcast', 'snow', 'blizzard', 'aurora'],
  '冰城': ['clear', 'cloudy', 'overcast', 'snow', 'blizzard'],
  '黑塔空间站': ['clear', 'overcast', 'star_dust_storm', 'energy_rain', 'data_storm'],
  '螺丝星': ['clear', 'cloudy', 'overcast', 'star_dust_storm', 'data_storm'],
  '空间站': ['clear', 'overcast', 'star_dust_storm', 'energy_rain'],
  '仙舟': ['clear', 'cloudy', 'overcast', 'light_rain', 'star_dust_storm', 'rift_wind', 'aurora', 'ether_fog', 'star_tide'],
  '罗浮': ['clear', 'cloudy', 'overcast', 'light_rain', 'star_dust_storm', 'rift_wind', 'aurora', 'ether_fog', 'star_tide'],
  '沙漠': ['clear', 'cloudy', 'overcast', 'star_dust_storm', 'rift_wind'],
  '荒漠': ['clear', 'cloudy', 'overcast', 'star_dust_storm'],
  '火山': ['clear', 'cloudy', 'overcast', 'rift_wind', 'ether_fog'],
  '匹诺康尼': ['clear', 'cloudy', 'overcast', 'light_rain', 'heavy_rain', 'ether_fog', 'aurora'],
  '都市': ['clear', 'cloudy', 'overcast', 'light_rain', 'heavy_rain', 'ether_fog', 'energy_rain'],
};

const 默认天气列表: 天气类型[] = ['clear', 'cloudy', 'overcast', 'light_rain', 'heavy_rain', 'ether_fog'];

export function 获取地点可用天气(地点: string): 天气类型[] {
  if (!地点) return 默认天气列表;
  const 地点归一化 = 地点.trim();
  for (const [keyword, weathers] of Object.entries(地点天气白名单)) {
    if (地点归一化.includes(keyword)) {
      return weathers;
    }
  }
  return 默认天气列表;
}

export function 验证天气合法性(天气: string, 地点: string): boolean {
  const 可用列表 = 获取地点可用天气(地点);
  return 可用列表.includes(天气 as 天气类型);
}

export function 构建天气Prompt片段(地点: string, 当前天气: string | undefined): string {
  const 可用列表 = 获取地点可用天气(地点);
  const 天气描述 = 可用列表
    .map((id) => {
      const def = 天气列表.find((w) => w.id === id);
      return def ? `${def.emoji} ${def.name}` : id;
    })
    .join('、');

  const 当前天气名 = 当前天气 ? (天气名映射[当前天气] ?? 当前天气) : '';
  const 上一回合 = 当前天气名 ? `上一回合天气：${当前天气名}` : '当前天气：未知（新开局）';

  return [
    '## 天气判断',
    '',
    `当前地点：${地点 || '未知'}`,
    上一回合,
    `此地可用天气：${天气描述}`,
    '',
    '请根据当前剧情氛围和地点特征，判断本回合天气。',
    '- 如果剧情没有明显天气暗示（如"下雨了""风雪交加""星空璀璨"），保持上一回合天气不变',
    '- 不要频繁切换天气（至少持续 3-5 回合）',
    '- 命名必须严格从「此地可用天气」中选择，不要自创天气名',
    '- 你的输出末尾必须包含 `<天气>天气名</天气>` 标签（天气名用中文，如 `<天气>暴风雪</天气>`）',
  ].join('\n');
}

export function 解析天气标签(responseText: string): string | null {
  const match = responseText.match(/<天气>(.+?)<\/天气>/);
  if (!match) return null;
  const raw = match[1].trim();
  const found = 天气列表.find((w) => w.name === raw);
  return found ? found.id : null;
}
