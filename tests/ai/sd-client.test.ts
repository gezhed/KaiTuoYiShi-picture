// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  构造SD载荷,
  解析SD种子,
  归一化第二轮步数,
  解析SD响应,
  SD认证头,
  拼接SDPath,
  规范化SD地址,
} from '@/services/ai/imageGen/sdClient';
import { 创建默认SD设置 } from '@/models/genSystem';

function 建设置(覆盖: Partial<ReturnType<typeof 创建默认SD设置>> = {}) {
  return { ...创建默认SD设置(), ...覆盖 };
}

describe('解析SD种子', () => {
  it('负数 / 非数字 / 空都返回 -1（交给服务端随机）', () => {
    for (const 输入 of [-1, -5, '', 'abc', undefined, Number.NaN]) {
      expect(解析SD种子(输入)).toBe(-1);
    }
  });

  it('空字符串与 undefined 也返回 -1（不能用 Number("")，那是 0）', () => {
    expect(解析SD种子('')).toBe(-1);
    expect(解析SD种子('   ')).toBe(-1);
    expect(解析SD种子(undefined)).toBe(-1);
  });

  it('0 是合法种子，不当作随机', () => {
    // 与 NovelAI 不同：A1111 的 0 是有效固定种子。
    expect(解析SD种子(0)).toBe(0);
    expect(解析SD种子('0')).toBe(0);
  });

  it('正数取整', () => {
    expect(解析SD种子(42.9)).toBe(42);
    expect(解析SD种子('123')).toBe(123);
  });
});

describe('归一化第二轮步数', () => {
  it('0 或负数表示沿用主步数', () => {
    expect(归一化第二轮步数(0, 28)).toBe(28);
    expect(归一化第二轮步数(-3, 20)).toBe(20);
  });

  it('正数原样取整', () => {
    expect(归一化第二轮步数(15, 28)).toBe(15);
    expect(归一化第二轮步数(12.7, 28)).toBe(12);
  });

  it('主步数非法时至少为 1', () => {
    expect(归一化第二轮步数(0, 0)).toBe(1);
    expect(归一化第二轮步数(0, Number.NaN)).toBe(1);
  });
});

describe('构造SD载荷', () => {
  it('发出 A1111 要求的全部字段', () => {
    const 载荷 = 构造SD载荷({
      设置: 建设置(),
      正向提示词: 'a girl',
      负向提示词: 'bad',
    });
    expect(载荷).toMatchObject({
      prompt: 'a girl',
      negative_prompt: 'bad',
      sampler_name: 'Euler a',
      scheduler: 'Automatic',
      steps: 28,
      cfg_scale: 7,
      width: 1024,
      height: 1024,
      restore_faces: false,
      enable_hr: false,
      hr_upscaler: 'Latent',
      hr_scale: 1,
      hr_additional_modules: [],
      denoising_strength: 0.7,
      override_settings_restore_afterwards: true,
      save_images: true,
      send_images: true,
      do_not_save_grid: false,
      do_not_save_samples: false,
    });
    expect(载荷.override_settings).toEqual({
      CLIP_stop_at_last_layers: 1,
      sd_vae: 'Automatic',
    });
  });

  it('数值字段发数字而不是字符串（上游发字符串，这里显式收窄）', () => {
    const 载荷 = 构造SD载荷({
      设置: 建设置({ 步数: 30, cfg: 7.5, 高清放大倍数: 2 }),
      正向提示词: 'a',
      负向提示词: '',
    });
    expect(typeof 载荷.steps).toBe('number');
    expect(typeof 载荷.cfg_scale).toBe('number');
    expect(typeof 载荷.hr_scale).toBe('number');
    expect(载荷.hr_scale).toBe(2);
  });

  it('覆盖尺寸优先于设置', () => {
    const 载荷 = 构造SD载荷({
      设置: 建设置(),
      正向提示词: 'a',
      负向提示词: '',
      宽度: 832,
      高度: 1216,
    });
    expect(载荷.width).toBe(832);
    expect(载荷.height).toBe(1216);
  });

  it('不定 ADetailer 时没有 alwayson_scripts', () => {
    const 载荷 = 构造SD载荷({ 设置: 建设置(), 正向提示词: 'a', 负向提示词: '' });
    expect(载荷).not.toHaveProperty('alwayson_scripts');
  });

  it('开了 ADetailer 时按位置参数发出 args', () => {
    const 载荷 = 构造SD载荷({
      设置: 建设置({ ADetailer: true }),
      正向提示词: 'a',
      负向提示词: '',
    });
    const 脚本 = 载荷.alwayson_scripts as { ADetailer: { args: unknown[] } };
    expect(脚本.ADetailer.args[0]).toBe(true);
    expect(脚本.ADetailer.args[1]).toBe(true);
    expect(脚本.ADetailer.args[2]).toEqual({ ad_model: 'face_yolov8n.pt' });
  });

  it('高清修复关闭时仍发出 hr_* 字段（A1111 要求字段存在）', () => {
    const 载荷 = 构造SD载荷({
      设置: 建设置({ 高清修复: false, 高清放大倍数: 2, 高清第二轮步数: 15 }),
      正向提示词: 'a',
      负向提示词: '',
    });
    expect(载荷.enable_hr).toBe(false);
    expect(载荷.hr_scale).toBe(2);
    expect(载荷.hr_second_pass_steps).toBe(15);
  });

  it('宽度高度至少 64', () => {
    const 载荷 = 构造SD载荷({
      设置: 建设置({ 宽度: 8, 高度: 0 }),
      正向提示词: 'a',
      负向提示词: '',
    });
    expect(载荷.width).toBe(64);
    expect(载荷.height).toBe(64);
  });
});

describe('解析SD响应', () => {
  const PNG = 'iVBORw0KGgo='; // 0x89 0x50 0x4e 0x47

  it('解出图片字节并嗅探类型', () => {
    const 响应 = 解析SD响应({ images: [PNG], info: '{"seed":123}' });
    expect(响应.字节[0]).toBe(0x89);
    expect(响应.mimeType).toBe('image/png');
    expect(响应.信息).toEqual({ seed: 123 });
  });

  it('接受带 data URL 前缀的实现', () => {
    const 响应 = 解析SD响应({ images: [`data:image/png;base64,${PNG}`] });
    expect(响应.字节[0]).toBe(0x89);
  });

  it('多张时取第一张非空', () => {
    const 响应 = 解析SD响应({ images: ['', PNG] });
    expect(响应.字节[0]).toBe(0x89);
  });

  it('info 不是合法 JSON 时置空而不报错（附加信息不该拖垮出图）', () => {
    const 响应 = 解析SD响应({ images: [PNG], info: '不是 JSON' });
    expect(响应.信息).toBeNull();
  });

  it('info 是对象时原样取用', () => {
    const 响应 = 解析SD响应({ images: [PNG], info: { seed: 7 } });
    expect(响应.信息).toEqual({ seed: 7 });
  });

  it('没有图片时报出可读错误', () => {
    expect(() => 解析SD响应({ images: [] })).toThrow(/没有返回图片/);
    expect(() => 解析SD响应({ images: [''] })).toThrow(/没有返回图片/);
    expect(() => 解析SD响应(null)).toThrow(/不是对象/);
  });
});

describe('地址与认证', () => {
  it('规范化去掉尾部斜杠', () => {
    expect(规范化SD地址('  http://127.0.0.1:7860///  ')).toBe('http://127.0.0.1:7860');
  });

  it('拼接路径时补齐斜杠', () => {
    expect(拼接SDPath('http://a:1/', 'sdapi/v1/txt2img')).toBe('http://a:1/sdapi/v1/txt2img');
    expect(拼接SDPath('http://a:1', '/sdapi/v1/txt2img')).toBe('http://a:1/sdapi/v1/txt2img');
  });

  it('认证为空时不发 Authorization', () => {
    expect(SD认证头('')).toEqual({});
    expect(SD认证头('   ')).toEqual({});
  });

  it('user:pass 转成 Basic', () => {
    expect(SD认证头('u:p')).toEqual({ Authorization: `Basic ${btoa('u:p')}` });
  });

  it('已带 scheme 时原样保留', () => {
    expect(SD认证头('Basic abc')).toEqual({ Authorization: 'Basic abc' });
  });
});
