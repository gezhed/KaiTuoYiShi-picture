import { describe, expect, it } from 'vitest';
import { 格式化ComfyUI错误, 规范化ComfyUI异常消息 } from '@/services/ai/imageGen/comfyError';

describe('格式化ComfyUI错误', () => {
  it('没有错误体时返回默认文案', () => {
    expect(格式化ComfyUI错误(null)).toBe('ComfyUI 请求失败');
    expect(格式化ComfyUI错误(undefined, '自定义')).toBe('自定义');
  });

  it('非 JSON 字符串原样返回', () => {
    expect(格式化ComfyUI错误('boom')).toBe('boom');
  });

  it('格式化校验失败并列出节点详情，条目以 | 连接', () => {
    const 错误体 = {
      error: { type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed validation' },
      node_errors: {
        3: { class_type: 'KSampler', errors: [{ message: 'Value 9999 bigger than max' }, { details: 'steps' }] },
        9: { class_type: 'CheckpointLoaderSimple', errors: [] },
      },
    };
    const 结果 = 格式化ComfyUI错误(错误体);
    expect(结果).toContain('ComfyUI 校验失败 [prompt_outputs_failed_validation]: Prompt outputs failed validation');
    expect(结果).toContain('【节点详情】');
    expect(结果).toContain('节点 #3 (KSampler): Value 9999 bigger than max; steps');
    expect(结果).toContain('节点 #9 (CheckpointLoaderSimple): 参数无效');
    expect(结果).toContain(' | ');
  });

  it('接受 JSON 字符串形式的错误体', () => {
    const 结果 = 格式化ComfyUI错误(JSON.stringify({ error: { message: 'bad' } }));
    expect(结果).toBe('ComfyUI 校验失败 [Prompt Error]: bad');
  });

  it('格式化执行期异常消息', () => {
    const 结果 = 格式化ComfyUI错误({
      messages: [['execution_error', {
        node_id: 7,
        node_type: 'VAEDecode',
        exception_type: 'RuntimeError',
        exception_message: 'out of memory',
      }]],
    });
    expect(结果).toBe('ComfyUI 节点执行出错: 节点 #7 [VAEDecode] (RuntimeError) - out of memory');
  });

  it('回落到 status_str/exception_message 与 message', () => {
    expect(格式化ComfyUI错误({ status_str: 'error', exception_message: 'crashed' }))
      .toBe('ComfyUI 任务执行出错: crashed');
    expect(格式化ComfyUI错误({ message: 'plain' })).toBe('plain');
    expect(格式化ComfyUI错误({ errorMessage: 'alt' })).toBe('alt');
  });
});

describe('规范化ComfyUI异常消息', () => {
  it('把浏览器的跨域类报错替换为可读说明', () => {
    expect(规范化ComfyUI异常消息('Failed to fetch'))
      .toContain('可能是服务不可达、跨域、代理异常或返回了无效响应');
    expect(规范化ComfyUI异常消息('Load failed')).toContain('可能是服务不可达');
  });

  it('其它消息原样保留', () => {
    expect(规范化ComfyUI异常消息('ComfyUI 服务器超时（已超过 30 分钟）。'))
      .toBe('ComfyUI 服务器超时（已超过 30 分钟）。');
  });
});
