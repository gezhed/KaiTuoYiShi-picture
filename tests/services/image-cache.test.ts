/**
 * 图片缓存的读取侧。
 *
 * 用户反馈：「图片缓存是不是坏了，我的图片缓存没有图片了，新生成的也不显示」。
 * 查下来写入一直是好的（`统计图片缓存` 的张数能看到），坏的是**读取**：
 * 图廊那格的状态从头到尾没人写过，读取函数（`读取缓存条目`/`读取缓存条目某张`）
 * 一个调用者都没有。这里把「列得出、顺序对、坏记录不展示」钉死。
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  追加缓存图片,
  列出缓存图片,
  删除缓存图片,
  清空图片缓存,
  统计图片缓存,
  打开图片缓存库,
  缓存图片表,
} from '@/services/imageCache';

function 建Blob(内容: string): Blob {
  return new Blob([内容], { type: 'image/png' });
}

beforeEach(async () => {
  await 清空图片缓存();
});

describe('列出缓存图片', () => {
  it('同一提示词的多张都列出来，并带上提示词与字节', async () => {
    await 追加缓存图片('image###1girl, solo###', 建Blob('a'), { width: 512, height: 512 });
    await 追加缓存图片('image###1girl, solo###', 建Blob('bb'), { width: 512, height: 512 });
    const 列表 = await 列出缓存图片();
    expect(列表).toHaveLength(2);
    expect(列表.every((项) => 项.条目.prompt.includes('1girl'))).toBe(true);
    expect(列表.every((项) => 项.blob.size > 0)).toBe(true);
  });

  it('新的排在前面（图廊默认先看最近生成的）', async () => {
    await 追加缓存图片('image###早###', 建Blob('early'));
    // createdAt 取毫秒时间戳，同毫秒内两次写入会打平，这里显式错开。
    await new Promise((resolve) => setTimeout(resolve, 2));
    await 追加缓存图片('image###晚###', 建Blob('late'));
    const 列表 = await 列出缓存图片();
    expect(列表[0].条目.prompt).toContain('晚');
    expect(列表[1].条目.prompt).toContain('早');
  });

  it('没有字节的残缺记录不展示（否则图廊里会出现永远加载不出的格子）', async () => {
    await 追加缓存图片('image###好的###', 建Blob('ok'));
    const db = await 打开图片缓存库();
    await new Promise<void>((resolve, reject) => {
      const 事务 = db.transaction(缓存图片表, 'readwrite');
      事务.objectStore(缓存图片表).put({
        id: 'broken-1', entryId: 'nope', mimeType: 'image/png', size: 0, createdAt: Date.now(),
      });
      事务.oncomplete = () => resolve();
      事务.onerror = () => reject(事务.error);
    });
    const 列表 = await 列出缓存图片();
    expect(列表).toHaveLength(1);
    expect(列表[0].条目.prompt).toContain('好的');
  });

  it('限制条数时只取最新的 N 张', async () => {
    for (const 内容 of ['1', '2', '3']) {
      await 追加缓存图片(`image###${内容}###`, 建Blob(内容));
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const 列表 = await 列出缓存图片(2);
    expect(列表).toHaveLength(2);
    expect(列表[0].条目.prompt).toContain('3');
    expect(列表[1].条目.prompt).toContain('2');
  });

  it('与统计口径一致：列表长度＝图片数，字节和＝总字节', async () => {
    await 追加缓存图片('image###a###', 建Blob('aaa'));
    await 追加缓存图片('image###b###', 建Blob('bbbb'));
    const [统计, 列表] = await Promise.all([统计图片缓存(), 列出缓存图片()]);
    expect(列表).toHaveLength(统计.图片数);
    expect(列表.reduce((累计, 项) => 累计 + 项.blob.size, 0)).toBe(统计.总字节);
  });
});

describe('删除单张', () => {
  it('删掉一张后列表与统计都减少，其它张保留', async () => {
    const 甲 = await 追加缓存图片('image###a###', 建Blob('aaa'));
    await 追加缓存图片('image###a###', 建Blob('bbb'));
    await 删除缓存图片(甲.图片.id);
    const 列表 = await 列出缓存图片();
    expect(列表).toHaveLength(1);
    expect(列表[0].图片.id).not.toBe(甲.图片.id);
    expect((await 统计图片缓存()).条目数).toBe(1);
  });

  it('删掉某条目的最后一张时，条目一并消失（不留空条目）', async () => {
    const 甲 = await 追加缓存图片('image###only###', 建Blob('aaa'));
    await 删除缓存图片(甲.图片.id);
    expect(await 列出缓存图片()).toHaveLength(0);
    expect((await 统计图片缓存()).条目数).toBe(0);
  });
});
