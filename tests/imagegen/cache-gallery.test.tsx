// @vitest-environment jsdom
/**
 * 「图片缓存」页必须真的把图列出来。
 *
 * 用户反馈：「我的图片缓存没有图片了，新生成的也不显示」。查下来写入一直是好的
 * （统计里能看到张数），坏的是读取：页面只取了计数，图廊那格的状态从头到尾没人写。
 * 这里从真组件走一遍：写两条缓存 → 打开「图片缓存」页 → 应看到两张图与提示词。
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ImageWorkbenchPanel } from '@/components/features/ImageGeneration/ImageWorkbenchPanel';
import { 追加缓存图片, 清空图片缓存, 列出缓存图片 } from '@/services/imageCache';
import { 创建空相册系统 } from '@/models/imageGeneration';
import { 创建默认文生图系统设置 } from '@/models/genSystem';

// jsdom 不实现 objectURL。图廊靠它把缓存里的 Blob 变成可显示的地址。
const 地址表: string[] = [];
beforeEach(async () => {
  地址表.length = 0;
  let 序号 = 0;
  globalThis.URL.createObjectURL = vi.fn(() => {
    序号 += 1;
    const 地址 = `blob:mock-${序号}`;
    地址表.push(地址);
    return 地址;
  });
  globalThis.URL.revokeObjectURL = vi.fn();
  await 清空图片缓存();
});

function 建面板() {
  return render(
    <ImageWorkbenchPanel
      album={创建空相册系统()}
      onAlbumChange={() => {}}
      traveler={{ 姓名: '开拓者' } as never}
      npcs={[]}
      state={{} as never}
      gameSettings={{ 文生图系统: 创建默认文生图系统设置() } as never}
      onOpenImageGenSettings={() => {}}
      onExportAlbum={() => {}}
      onImportAlbum={() => {}}
    />,
  );
}

describe('图片缓存页', () => {
  it('缓存里有图时列出来，并带上提示词与容量', async () => {
    await 追加缓存图片('image###1girl, white coat###', new Blob(['aaa'], { type: 'image/png' }), {
      width: 832, height: 1216,
    });
    await 追加缓存图片('image###2girls, rain###', new Blob(['bbbb'], { type: 'image/png' }), {
      width: 1024, height: 1024,
    });

    建面板();
    fireEvent.click(screen.getByRole('button', { name: /图片缓存/ }));

    await waitFor(() => {
      expect(screen.getByText(/1girl, white coat/)).toBeInTheDocument();
    });
    expect(screen.getByText(/2girls, rain/)).toBeInTheDocument();
    expect(screen.getByText(/图片 2 张/)).toBeInTheDocument();
    const 图 = screen.getAllByRole('img');
    expect(图).toHaveLength(2);
    expect(图[0].getAttribute('src')).toMatch(/^blob:/);
  });

  it('缓存为空时说明原因，而不是留一片空白', async () => {
    建面板();
    fireEvent.click(screen.getByRole('button', { name: /图片缓存/ }));
    await waitFor(() => {
      expect(screen.getByText(/缓存里还没有图片/)).toBeInTheDocument();
    });
  });

  it('「删除这一张」只从缓存里移除它，其余保留', async () => {
    await 追加缓存图片('image###甲###', new Blob(['aaa'], { type: 'image/png' }));
    await 追加缓存图片('image###乙###', new Blob(['bbb'], { type: 'image/png' }));
    建面板();
    fireEvent.click(screen.getByRole('button', { name: /图片缓存/ }));
    await waitFor(() => {
      expect(screen.getByText(/甲/)).toBeInTheDocument();
    });

    const 删除按钮 = screen.getAllByRole('button', { name: '删除这一张' });
    expect(删除按钮).toHaveLength(2);
    fireEvent.click(删除按钮[0]);

    await waitFor(async () => {
      const 剩余 = await 列出缓存图片();
      expect(剩余).toHaveLength(1);
    });
    expect(await 列出缓存图片()).toHaveLength(1);
  });

  it('「清空缓存」后页面与库都为空白', async () => {
    await 追加缓存图片('image###甲###', new Blob(['aaa'], { type: 'image/png' }));
    建面板();
    fireEvent.click(screen.getByRole('button', { name: /图片缓存/ }));
    await waitFor(() => {
      expect(screen.getByText(/甲/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '清空缓存' }));
    await waitFor(() => {
      expect(screen.getByText(/缓存里还没有图片/)).toBeInTheDocument();
    });
    expect(await 列出缓存图片()).toHaveLength(0);
  });
});
