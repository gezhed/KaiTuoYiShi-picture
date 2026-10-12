import { describe, expect, it } from 'vitest';
import {
  解析词库数据,
  建检索索引,
  检索词条,
  建词库树,
  取基名,
  带权重,
  去重标签串,
  组装标签串,
  追加标签串,
  上游词库文件名,
} from '@/services/vocabulary/vocabulary';

describe('解析词库数据：扁平形态', () => {
  it('读 danbooru_tag 并保留热度', () => {
    const 结果 = 解析词库数据('danbooru_001.json', {
      danbooru_tag: [
        { id_index: 1, tag: '1girl', color_id: 0, translate: '一个女孩', hot: 5975112, aliases: 1 },
        { id_index: 2, tag: 'solo', translate: '单人', hot: 100 },
      ],
    });
    expect(结果.分层).toBe(false);
    expect(结果.词条).toHaveLength(2);
    expect(结果.词条[0]).toMatchObject({ name: '1girl', translation: '一个女孩', hot: 5975112 });
    expect(结果.词条[0].fileName).toBe('danbooru_001.json');
  });

  it('接受顶层直接是数组', () => {
    const 结果 = 解析词库数据('x.json', [{ tag: 'a', translate: '甲' }]);
    expect(结果.分层).toBe(false);
    expect(结果.词条).toHaveLength(1);
  });

  it('跳过没有名字的条目与非法项', () => {
    const 结果 = 解析词库数据('x.json', { danbooru_tag: [{ translate: '无名' }, null, { tag: 'ok' }] });
    expect(结果.词条.map((项) => 项.name)).toEqual(['ok']);
  });
});

describe('解析词库数据：分层形态', () => {
  it('读 tag_groups 的子分组与 tag_tags', () => {
    const 结果 = 解析词库数据('tags.json', {
      tag_groups: [
        { id_index: 11, name: '人物', color: 'c', subgroups: [{ id_index: 1, group_id: 11, name: '对象', color: 'c' }] },
      ],
      tag_tags: [
        { text: 'tentacle', desc: '触手', subgroup_id: 1 },
        { text: 'orphan', desc: '孤儿' },
      ],
    });
    expect(结果.分层).toBe(true);
    expect(结果.分组).toHaveLength(1);
    expect(结果.子分组).toHaveLength(1);
    expect(结果.词条).toHaveLength(2);
    // 分层文件没有热度字段 → 统一 -1（排序置顶）。
    expect(结果.词条[0].hot).toBe(-1);
    expect(结果.词条[0].subgroupId).toBe(1);
    expect(结果.词条[1].subgroupId).toBeUndefined();
  });

  it('单组无子分组时造虚拟子分组，复用组的 id 与名字', () => {
    const 结果 = 解析词库数据('tag_NSFW001.json', {
      tag_groups: [{ id_index: 11, name: 'NSFW', color: 'c', subgroups: [] }],
      tag_tags: [{ text: 'x', desc: 'X' }],
    });
    expect(结果.子分组).toHaveLength(1);
    expect(结果.子分组[0]).toMatchObject({ idIndex: 11, groupId: 11, name: 'NSFW' });
  });
});

describe('检索词条', () => {
  const 索引 = 建检索索引([
    { name: '1girl', translation: '一个女孩', hot: 500, fileName: 'f' },
    { name: '2girls', translation: '两个女孩', hot: 300, fileName: 'f' },
    { name: 'solo', translation: '单人', hot: 100, fileName: 'f' },
    { name: 'unknown_tag', translation: '', hot: -1, fileName: 'f' },
  ]);

  it('按名称或译文命中', () => {
    expect(检索词条(索引, '1girl').map((项) => 项.name)).toEqual(['1girl']);
    expect(检索词条(索引, '单人').map((项) => 项.name)).toEqual(['solo']);
  });

  it('默认按热度降序', () => {
    expect(检索词条(索引, 'girl').map((项) => 项.name)).toEqual(['1girl', '2girls']);
  });

  it('热度 -1（未知）排在最前并按字典序', () => {
    const 结果 = 检索词条(索引, 'tag');
    expect(结果[0].name).toBe('unknown_tag');
  });

  it('startsWith 只匹配开头', () => {
    expect(检索词条(索引, 'girl', { startsWith: true })).toHaveLength(0);
    expect(检索词条(索引, '1g', { startsWith: true }).map((项) => 项.name)).toEqual(['1girl']);
  });

  it('按名称去重，先到先得', () => {
    const 重复 = 建检索索引([
      { name: 'dup', translation: '甲', hot: 10, fileName: 'a' },
      { name: 'dup', translation: '乙', hot: 20, fileName: 'b' },
    ]);
    const 结果 = 检索词条(重复, 'dup');
    expect(结果).toHaveLength(1);
    expect(结果[0].translation).toBe('甲');
  });

  it('limit 截断且空关键词返回空', () => {
    expect(检索词条(索引, 'girl', { limit: 1 })).toHaveLength(1);
    expect(检索词条(索引, '')).toEqual([]);
    expect(检索词条(索引, '   ')).toEqual([]);
  });

  it('hot_asc 与 key_asc 排序可选', () => {
    expect(检索词条(索引, 'girl', { sortBy: 'hot_asc' }).map((项) => 项.name)).toEqual(['2girls', '1girl']);
    const 键序 = 检索词条(索引, 'girl', { sortBy: 'key_asc' }).map((项) => 项.name);
    expect(键序).toEqual([...键序].sort());
  });

  it('大小写不敏感', () => {
    expect(检索词条(索引, '1GIRL').map((项) => 项.name)).toEqual(['1girl']);
  });
});

describe('建词库树', () => {
  it('按 group → subgroup → tags 归并', () => {
    const 树 = 建词库树(
      [{ idIndex: 1, name: '人物', color: '', fileName: 'f' }],
      [{ idIndex: 2, groupId: 1, name: '对象', color: '', fileName: 'f' }],
      [{ name: 'a', translation: '甲', hot: -1, fileName: 'f', subgroupId: 2 }],
    );
    expect(树.groups).toHaveLength(1);
    expect(树.groups[0].subgroups).toHaveLength(1);
    expect(树.groups[0].subgroups[0].tags).toEqual([{ text: 'a', desc: '甲' }]);
  });

  it('没有匹配子分组的词条不会凭空造组', () => {
    const 树 = 建词库树(
      [{ idIndex: 1, name: '人物', color: '', fileName: 'f' }],
      [],
      [{ name: 'a', translation: '', hot: -1, fileName: 'f', subgroupId: 99 }],
    );
    expect(树.groups[0].subgroups).toEqual([]);
  });
});

describe('取基名与带权重', () => {
  it('剥掉括号与权重语法', () => {
    expect(取基名('(tag:1.2)')).toBe('tag');
    expect(取基名('[[tag]]')).toBe('tag');
    expect(取基名('tag:0.8')).toBe('tag');
    expect(取基名('2::tag::')).toBe('tag');
    expect(取基名('tag')).toBe('tag');
  });

  it('带权重判断', () => {
    expect(带权重('(tag:1.2)')).toBe(true);
    expect(带权重('tag:0.8')).toBe(true);
    expect(带权重('tag')).toBe(false);
    expect(带权重('')).toBe(false);
  });
});

describe('去重标签串', () => {
  it('同名只留一个，且带权重的胜出（与顺序无关）', () => {
    expect(去重标签串('tag, (tag:1.2)')).toBe('(tag:1.2)');
    expect(去重标签串('(tag:1.2), tag')).toBe('(tag:1.2)');
  });

  it('不同名全部保留并规范连接符', () => {
    expect(去重标签串('a ,  b,,c')).toBe('a, b, c');
  });

  it('空输入返回空串', () => {
    expect(去重标签串('')).toBe('');
    expect(去重标签串(' , , ')).toBe('');
  });

  it('保护 $…$ 段，段内逗号不参与切分', () => {
    const 结果 = 去重标签串('$名字-sfw-upperbody$, solo');
    expect(结果).toBe('$名字-sfw-upperbody$, solo');
  });

  it('$…$ 段与普通标签同名时不互相吞并', () => {
    const 结果 = 去重标签串('$a$, $b$');
    expect(结果).toBe('$a$, $b$');
  });
});

describe('组装标签串', () => {
  it('写成 名称（译文） 形态并去重', () => {
    expect(组装标签串([
      { name: '1girl', translation: '一个女孩' },
      { name: 'solo', translation: '单人' },
    ])).toBe('1girl（一个女孩）, solo（单人）');
  });

  it('没有译文时只写名称', () => {
    expect(组装标签串([{ name: 'solo' }])).toBe('solo');
  });

  it('跳过空名称', () => {
    expect(组装标签串([{ name: '  ' }, { name: 'a', translation: 'A' }])).toBe('a（A）');
  });

  it('同名去重', () => {
    expect(组装标签串([{ name: 'a', translation: 'A' }, { name: 'a', translation: 'A' }])).toBe('a（A）');
  });
});

describe('追加标签串', () => {
  it('并进已有内容而不是替换', () => {
    expect(追加标签串('silver hair', 'green eyes')).toBe('silver hair, green eyes');
  });

  it('已有内容为空或未定义时直接用新增串', () => {
    expect(追加标签串('', 'solo')).toBe('solo');
    expect(追加标签串(undefined, 'solo')).toBe('solo');
    expect(追加标签串('  ', 'solo')).toBe('solo');
  });

  it('新增为空时保留原文（不清空字段）', () => {
    expect(追加标签串('silver hair', '')).toBe('silver hair');
    expect(追加标签串('silver hair', undefined)).toBe('silver hair');
  });

  it('两边都空时返回空串', () => {
    expect(追加标签串('', '')).toBe('');
  });

  it('跨两次追加去重，带权重者胜出但保留首次出现的位置', () => {
    expect(追加标签串('tag', 'tag')).toBe('tag');
    // 原文本里的 `tag` 先占位，新增的 `(tag:1.2)` 只替换值、不挪位置。
    expect(追加标签串('tag, solo', 'solo, (tag:1.2)')).toBe('(tag:1.2), solo');
    // 反过来：新增串在前时也同理。
    expect(追加标签串('(tag:1.2)', 'tag')).toBe('(tag:1.2)');
  });

  it('保留 $…$ 角色触发段', () => {
    expect(追加标签串('$名字-sfw-upperbody$', 'solo')).toBe('$名字-sfw-upperbody$, solo');
  });
});

describe('上游词库文件名', () => {
  it('25 个 danbooru + tags + NSFW，共 27 个', () => {
    expect(上游词库文件名).toHaveLength(27);
    expect(上游词库文件名[0]).toBe('danbooru_001.json');
    expect(上游词库文件名[24]).toBe('danbooru_025.json');
    expect(上游词库文件名).toContain('tags.json');
    expect(上游词库文件名).toContain('tag_NSFW001.json');
  });
});
