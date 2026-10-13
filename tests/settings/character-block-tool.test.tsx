// @vitest-environment jsdom
/**
 * 「角色提示词小工具」与手动出图的联动测试。
 *
 * 重点在**语法**：`$…$` 写错不会报错，只会整段不生效（既不替换又占词元）。
 * 所以这里不只比对字符串，还把拼出来的块喂给真实解析器，
 * 确认它真的会被当成角色段、并替换成角色卡上的字段。
 */
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CharacterBlockTool, 拼角色块, 插入提示词块 } from '@/components/features/ImageGeneration/CharacterBlockTool';
import { 处理角色提示词 } from '@/services/ai/imageGen/characterPrompt';
import { 创建空角色部位字段 } from '@/models/genSystem';
import type { 角色卡 } from '@/models/genSystem';

function 建角色(覆盖: Partial<角色卡> = {}): 角色卡 {
  return {
    ...创建空角色部位字段(),
    id: 'char_1',
    nameCN: '流萤|萨姆',
    nameEN: 'Firefly',
    enabled: true,
    aliases: [],
    outfits: [],
    selectedOutfitId: '',
    photoMedia: [],
    audioMedia: [],
    selectedPhotoId: '',
    selectedAudioId: '',
    photoPrompt: '',
    sendPhoto: false,
    位置: null,
    createdAt: 0,
    updatedAt: 0,
    characterTraits: '银发红瞳的少女',
    facialFeatures: '绿眼睛',
    upperBodySFW: '白色衬衫',
    upperBodyNSFW: '赤裸的上身',
    fullBodySFW: '百褶短裙',
    fullBodyNSFW: '赤裸的双腿',
    upperBodySFWBack: '白衬衫背面',
    ...覆盖,
  };
}

function 壳({ 角色列表, on插入 }: { 角色列表: 角色卡[]; on插入?: (块: string) => void }) {
  const [插入记录, set插入记录] = useState<string[]>([]);
  return (
    <div>
      <CharacterBlockTool
        角色列表={角色列表}
        on插入={(块) => {
          set插入记录((旧) => [...旧, 块]);
          on插入?.(块);
        }}
      />
      <div data-testid="插入记录">{插入记录.join('|')}</div>
    </div>
  );
}

describe('角色提示词小工具', () => {
  it('拼出来的块能被真实解析器识别，并替换成角色卡字段', () => {
    const 块 = 拼角色块('march 7th', { 角度: 'front view', 穿衣: 'sfw', 部位: 'upper' });
    // 语法：`${键值对}$`（不是 `${对象}$`）。
    expect(块).toBe('${"name":"march 7th", "angle":"front view", "upperBody":"sfw", "lowerBody":"hidden"}$');

    const 卡 = 建角色({ nameCN: 'march 7th' });
    const 解析 = 处理角色提示词(`1girl, ${块}`, { 启用列表: [卡.id], 全部角色: { [卡.id]: 卡 } });
    expect(解析.未识别段).toEqual([]);
    expect(解析.提示词).toContain('银发红瞳的少女');
    expect(解析.提示词).toContain('白色衬衫');
    // 只画上半身：下半身的字段不该出现。
    expect(解析.提示词).not.toContain('百褶短裙');
  });

  it('三种部位与穿衣档位拼出的键值对都对', () => {
    expect(拼角色块('甲', { 角度: 'from behind', 穿衣: 'nsfw', 部位: 'upper' }))
      .toContain('"angle":"from behind", "upperBody":"nsfw", "lowerBody":"hidden"');
    expect(拼角色块('甲', { 角度: 'from side', 穿衣: 'sfw', 部位: 'lower' }))
      .toContain('"upperBody":"hidden", "lowerBody":"sfw"');
    expect(拼角色块('甲', { 角度: 'front view', 穿衣: 'sfw', 部位: 'both' }))
      .toContain('"upperBody":"sfw", "lowerBody":"sfw"');
  });

  it('背面档位会走背面字段', () => {
    const 卡 = 建角色();
    const 块 = 拼角色块('流萤', { 角度: 'from behind', 穿衣: 'sfw', 部位: 'upper' });
    const 解析 = 处理角色提示词(块, { 启用列表: [卡.id], 全部角色: { [卡.id]: 卡 } });
    expect(解析.提示词).toContain('白衬衫背面');
    expect(解析.提示词).not.toContain('白色衬衫');
  });

  it('背面角度的措辞放宽：behind view / back view / 背面 都走背面字段', () => {
    const 卡 = 建角色();
    const 上下文 = { 启用列表: [卡.id], 全部角色: { [卡.id]: 卡 } };
    for (const 角度 of ['behind view', 'back view', 'rear view', '背面', 'from behind']) {
      const 块 = 拼角色块('流萤', { 角度: 角度 as never, 穿衣: 'sfw', 部位: 'upper' });
      const 解析 = 处理角色提示词(块, 上下文);
      expect(解析.提示词, 角度).toContain('白衬衫背面');
    }
    // 正面措辞不该被误判成背面。
    const 正面 = 处理角色提示词(拼角色块('流萤', { 角度: 'front view', 穿衣: 'sfw', 部位: 'upper' }), 上下文);
    expect(正面.提示词).toContain('白色衬衫');
  });

  it('选完点插入，块会带上完整语法交给上层', async () => {
    const on插入 = vi.fn();
    render(<壳 角色列表={[建角色()]} on插入={on插入} />);

    fireEvent.change(screen.getByLabelText('角色名'), { target: { value: '流萤' } });
    fireEvent.change(screen.getByLabelText('穿衣'), { target: { value: 'nsfw' } });
    fireEvent.click(screen.getByRole('button', { name: '下半身' }));
    fireEvent.click(screen.getByRole('button', { name: '插入到提示词' }));

    await waitFor(() => expect(on插入).toHaveBeenCalledTimes(1));
    expect(on插入.mock.calls[0][0])
      .toBe('${"name":"流萤", "angle":"front view", "upperBody":"hidden", "lowerBody":"nsfw"}$');
    expect(screen.getByTestId('插入记录').textContent).toContain('"lowerBody":"nsfw"');
  });

  it('插入时不动手写的那部分：没聚焦就追加到末尾，聚焦了才按光标插', () => {
    const 块 = '${"name":"流萤", "angle":"front view", "upperBody":"sfw", "lowerBody":"hidden"}$';

    // 没聚焦（textarea 的 selectionStart 是 0，但那是「没点过」不是「光标在开头」）
    expect(插入提示词块('1girl, solo, silver hair', 块, null))
      .toEqual({ 文本: `1girl, solo, silver hair, ${块}`, 光标: `1girl, solo, silver hair, ${块}`.length });
    // 末尾多余的逗号/空白先清掉，避免出现「, , 」
    expect(插入提示词块('1girl, ', 块, null).文本).toBe(`1girl, ${块}`);
    // 空提示词就只放块
    expect(插入提示词块('', 块, null).文本).toBe(块);

    // 聚焦在中间：按光标插，前后补分隔符
    const 中间 = 插入提示词块('1girl, solo, upper body', 块, { 起: 7, 止: 7 });
    expect(中间.文本).toBe(`1girl, ${块}, solo, upper body`);
    expect(中间.光标).toBe(`1girl, ${块}`.length);
    // 选中一段再插：选中的内容被替换掉
    expect(插入提示词块('1girl, XXXX, upper body', 块, { 起: 7, 止: 11 }).文本)
      .toBe(`1girl, ${块}, upper body`);
  });

  it('名字在角色卡里找不到时会先提醒（否则那段会原样留给模型）', async () => {
    render(<壳 角色列表={[建角色()]} />);
    fireEvent.change(screen.getByLabelText('角色名'), { target: { value: '查无此人' } });
    expect(await screen.findByText(/不在角色卡的名称\/别名里/)).toBeInTheDocument();

    // 名字对上就不提醒了（`|` 分隔的别名也算）。
    fireEvent.change(screen.getByLabelText('角色名'), { target: { value: '萨姆' } });
    await waitFor(() => {
      expect(screen.queryByText(/不在角色卡的名称\/别名里/)).not.toBeInTheDocument();
    });
  });

  it('没填名字时不能插入（免得插进去一段永远不生效的块）', () => {
    render(<壳 角色列表={[建角色()]} />);
    expect(screen.getByRole('button', { name: '插入到提示词' })).toBeDisabled();
  });
});
