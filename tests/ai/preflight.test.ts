import { describe, expect, it } from 'vitest';
import { 运行自检 } from '@/services/ai/imageGen/preflight';
import { 创建默认文生图系统设置, 创建空角色部位字段, 建LoRA条目 } from '@/models/genSystem';
import type { 文生图系统设置 } from '@/models/genSystem';

function 建设置(补丁: (项: 文生图系统设置) => void = () => {}): 文生图系统设置 {
  const 设置 = 创建默认文生图系统设置();
  补丁(设置);
  return 设置;
}

const 标题列表 = (结果: ReturnType<typeof 运行自检>) => 结果.检查项.map((项) => 项.标题);

const 空白Comfy工作流 = JSON.stringify({
  3: { class_type: 'KSampler', inputs: { seed: '%seed%', positive: ['6', 0], negative: ['7', 0] } },
  6: { class_type: 'CLIPTextEncode', inputs: { text: '%prompt%' } },
  7: { class_type: 'CLIPTextEncode', inputs: { text: '%negative%' } },
});

describe('运行自检：通用检查', () => {
  it('未启用时判为不可出图', () => {
    const 结果 = 运行自检(建设置());
    expect(结果.可出图).toBe(false);
    expect(标题列表(结果)).toContain('文生图未启用');
  });

  it('LLM启用但没填模型时报阻塞错误', () => {
    const 结果 = 运行自检(建设置((项) => {
      项.启用 = true;
      项.LLM.启用 = true;
      项.LLM.API.model = '';
    }));
    expect(结果.可出图).toBe(false);
    expect(标题列表(结果)).toContain('LLM没有填模型');
  });

  it('LLM未启用只是提示，不阻塞出图', () => {
    // 默认档案本身是完整可用的（地址已填、工作流需给），所以只需补上工作流。
    const 结果 = 运行自检(建设置((项) => {
      项.启用 = true;
      项.LLM.启用 = false;
      const 档案 = 项.comfyui.档案列表[项.comfyui.当前档案];
      档案.连接.地址 = 'http://127.0.0.1:8188';
      档案.工作流Json = 空白Comfy工作流;
    }));
    expect(结果.可出图).toBe(true);
    expect(标题列表(结果)).toContain('LLM未启用');
  });

  it('尺寸超上限给警告而不是错误', () => {
    const 结果 = 运行自检(建设置((项) => {
      项.启用 = true;
      项.渠道 = 'novelai';
      项.novelai.宽度 = 8192;
      项.novelai.Token = 't';
    }));
    const 项 = 结果.检查项.find((检查) => 检查.标题.includes('宽度偏大'));
    expect(项?.级别).toBe('warning');
  });

  it('渠道不同时检查项不同', () => {
    // SD 渠道缺地址 → 有 SD 专属检查项；ComfyUI 渠道 → 没有。
    const comfy = 运行自检(建设置((项) => {
      项.启用 = true;
      项.渠道 = 'comfyui';
      const 档案 = 项.comfyui.档案列表[项.comfyui.当前档案];
      档案.工作流Json = 空白Comfy工作流;
    }));
    const sd = 运行自检(建设置((项) => {
      项.启用 = true;
      项.渠道 = 'sd';
      项.sd.地址 = '';
    }));
    expect(comfy.渠道).toBe('comfyui');
    expect(sd.渠道).toBe('sd');
    expect(标题列表(sd)).toContain('没有填 SD WebUI 地址');
    expect(标题列表(comfy)).not.toContain('没有填 SD WebUI 地址');
  });
});

describe('运行自检：ComfyUI', () => {
  it('完整配置可通过', () => {
    const 结果 = 运行自检(建设置((项) => {
      项.启用 = true;
      const 档案 = 项.comfyui.档案列表[项.comfyui.当前档案];
      档案.连接.地址 = 'http://127.0.0.1:8188';
      档案.工作流Json = 空白Comfy工作流;
      项.comfyui.参考图上传 = false;
    }));
    expect(结果.可出图).toBe(true);
  });

  it('地址为空时阻塞', () => {
    const 结果 = 运行自检(建设置((项) => {
      项.启用 = true;
      const 档案 = 项.comfyui.档案列表[项.comfyui.当前档案];
      档案.连接.地址 = '';
      档案.工作流Json = 空白Comfy工作流;
    }));
    expect(结果.可出图).toBe(false);
    expect(标题列表(结果)).toContain('没有填 ComfyUI 地址');
  });

  it('识别 UI 格式工作流并给出导出指引', () => {
    const 结果 = 运行自检(建设置((项) => {
      项.启用 = true;
      const 档案 = 项.comfyui.档案列表[项.comfyui.当前档案];
      档案.连接.地址 = 'http://a';
      // 带 nodes 但没有以节点 id 为键 → 判为 UI 格式。
      档案.工作流Json = JSON.stringify({ nodes: [{ id: 1 }], links: [] });
    }));
    const 项 = 结果.检查项.find((检查) => 检查.标题.includes('UI 格式'));
    expect(项?.级别).toBe('error');
    expect(项?.说明).toContain('Save (API Format)');
    expect(结果.可出图).toBe(false);
  });

  it('合法 JSON 但没有 class_type 时报不是节点对象（而不是静默通过）', () => {
    const 结果 = 运行自检(建设置((项) => {
      项.启用 = true;
      const 档案 = 项.comfyui.档案列表[项.comfyui.当前档案];
      档案.连接.地址 = 'http://a';
      档案.工作流Json = JSON.stringify({ a: 1, b: 'x' });
    }));
    expect(标题列表(结果)).toContain('工作流不是合法的节点对象');
    expect(结果.可出图).toBe(false);
  });

  it('工作流不是合法 JSON 时报解析错误', () => {
    const 结果 = 运行自检(建设置((项) => {
      项.启用 = true;
      const 档案 = 项.comfyui.档案列表[项.comfyui.当前档案];
      档案.连接.地址 = 'http://a';
      档案.工作流Json = '{ 这不是 JSON';
    }));
    expect(标题列表(结果)).toContain('工作流不是合法 JSON');
    expect(结果.可出图).toBe(false);
  });

  it('工作流为空时阻塞', () => {
    const 结果 = 运行自检(建设置((项) => {
      项.启用 = true;
      const 档案 = 项.comfyui.档案列表[项.comfyui.当前档案];
      档案.连接.地址 = 'http://a';
      档案.工作流Json = '   ';
    }));
    expect(结果.可出图).toBe(false);
    expect(标题列表(结果)).toContain('工作流是空的');
  });

  it('档案不存在时阻塞并提前返回', () => {
    const 结果 = 运行自检(建设置((项) => {
      项.启用 = true;
      项.comfyui.当前档案 = '不存在';
    }));
    expect(结果.可出图).toBe(false);
    expect(标题列表(结果)).toContain('找不到工作流档案「不存在」');
  });

  it('缺正向占位符时给警告', () => {
    const 结果 = 运行自检(建设置((项) => {
      项.启用 = true;
      const 档案 = 项.comfyui.档案列表[项.comfyui.当前档案];
      档案.连接.地址 = 'http://a';
      档案.工作流Json = JSON.stringify({ 1: { class_type: 'X', inputs: { text: '%negative%' } } });
    }));
    const 项 = 结果.检查项.find((检查) => 检查.标题.includes('正向提示词'));
    expect(项?.级别).toBe('warning');
  });

  it('开了参考图上传但工作流没有参考图占位符时给警告', () => {
    const 结果 = 运行自检(建设置((项) => {
      项.启用 = true;
      项.comfyui.参考图上传 = true;
      const 档案 = 项.comfyui.档案列表[项.comfyui.当前档案];
      档案.连接.地址 = 'http://a';
      档案.工作流Json = 空白Comfy工作流;
    }));
    const 项 = 结果.检查项.find((检查) => 检查.标题.includes('没有参考图占位符'));
    expect(项?.级别).toBe('warning');
  });

  it('参考图占位符存在时不告警', () => {
    const 结果 = 运行自检(建设置((项) => {
      项.启用 = true;
      项.comfyui.参考图上传 = true;
      const 档案 = 项.comfyui.档案列表[项.comfyui.当前档案];
      档案.连接.地址 = 'http://a';
      档案.工作流Json = JSON.stringify({
        1: { class_type: 'LoadImage', inputs: { image: 'x.png', 备注: '%comfyuicankaotupian%' } },
        6: { class_type: 'C', inputs: { text: '%prompt%' } },
        7: { class_type: 'C', inputs: { text: '%negative%' } },
      });
    }));
    expect(标题列表(结果).some((项) => 项.includes('没有参考图占位符'))).toBe(false);
  });

  it('工作流里的非占位符 % 文本不会被误报', () => {
    const 结果 = 运行自检(建设置((项) => {
      项.启用 = true;
      const 档案 = 项.comfyui.档案列表[项.comfyui.当前档案];
      档案.连接.地址 = 'http://a';
      档案.工作流Json = JSON.stringify({
        1: { class_type: 'C', inputs: { text: '50% opacity %prompt%', other: '%negative%' } },
      });
    }));
    expect(标题列表(结果).some((项) => 项.includes('不认识的占位符'))).toBe(false);
  });
});

describe('运行自检：NovelAI', () => {
  it('缺 Token 时阻塞', () => {
    const 结果 = 运行自检(建设置((项) => {
      项.启用 = true;
      项.渠道 = 'novelai';
      项.novelai.Token = '';
    }));
    expect(结果.可出图).toBe(false);
    expect(标题列表(结果)).toContain('没有填 NovelAI Token');
  });

  it('第三方地址提示会依次尝试多个候选', () => {
    const 结果 = 运行自检(建设置((项) => {
      项.启用 = true;
      项.渠道 = 'novelai';
      项.novelai.Token = 't';
      项.novelai.地址 = 'https://third.party';
    }));
    const 项 = 结果.检查项.find((检查) => 检查.标题.includes('依次尝试'));
    expect(项?.级别).toBe('info');
    expect(项?.说明).toContain('/ai/generate-image');
  });

  it('未知模型给警告并说明编码键会退回默认', () => {
    const 结果 = 运行自检(建设置((项) => {
      项.启用 = true;
      项.渠道 = 'novelai';
      项.novelai.Token = 't';
      项.novelai.模型 = 'sd-xl-base';
    }));
    const 项 = 结果.检查项.find((检查) => 检查.标题.includes('不在已知列表里'));
    expect(项?.级别).toBe('warning');
    expect(项?.说明).toContain('v4-5curated');
  });

  it('Vibe 模式下没有条目时给警告', () => {
    const 结果 = 运行自检(建设置((项) => {
      项.启用 = true;
      项.渠道 = 'novelai';
      项.novelai.Token = 't';
      项.novelai.参考模式 = 'vibe';
    }));
    expect(标题列表(结果)).toContain('参考模式是 Vibe，但没有任何 Vibe 条目');
  });

  it('Vibe 条目全部取不到编码时阻塞', () => {
    const 结果 = 运行自检(建设置((项) => {
      项.启用 = true;
      项.渠道 = 'novelai';
      项.novelai.Token = 't';
      项.novelai.模型 = 'nai-diffusion-4-full';
      项.novelai.参考模式 = 'vibe';
      项.角色卡 = {
        c1: {
          参考组: {
            references: [{
              媒体Id: JSON.stringify({ encodings: { v3: { k: { encoding: 'E' } } } }),
              类型: 'style', 强度: 0.6, 保真度: 0.6,
            }],
            createdAt: 0, updatedAt: 0,
          },
        } as never,
      };
    }));
    const 项 = 结果.检查项.find((检查) => 检查.标题.includes('没有一个 Vibe 能用于当前模型'));
    expect(项?.级别).toBe('error');
    expect(结果.可出图).toBe(false);
  });

  it('Vibe 条目可用时给出信息项', () => {
    const 结果 = 运行自检(建设置((项) => {
      项.启用 = true;
      项.渠道 = 'novelai';
      项.novelai.Token = 't';
      项.novelai.模型 = 'nai-diffusion-4-full';
      项.novelai.参考模式 = 'vibe';
      项.角色卡 = {
        c1: {
          参考组: {
            references: [{
              媒体Id: JSON.stringify({ encodings: { v4full: { k: { encoding: 'E' } } } }),
              类型: 'style', 强度: 0.6, 保真度: 0.6,
            }],
            createdAt: 0, updatedAt: 0,
          },
        } as never,
      };
    }));
    expect(标题列表(结果)).toContain('1 个 Vibe 可用');
    expect(结果.可出图).toBe(true);
  });
});

describe('运行自检：工作流资源校验（用服务端列表核对写死的模型名）', () => {
  const 资源 = {
    模型: ['v1-5-pruned-emaonly.safetensors', 'sd_xl_base_1.0.safetensors'],
    采样器: ['euler', 'euler_ancestral'],
    调度器: ['normal', 'karras'],
    vae: ['vae-ft-mse-840000-ema-pruned.safetensors'],
    clip: ['clip_l.safetensors'],
    lora: ['add_detail.safetensors'],
  };


/** 造一张带 LoRA 的角色卡（角色 LoRA 槽位自检用）。 */
function 建带LoRA的角色(名称: string) {
  return {
    ...创建空角色部位字段(),
    id: 'char_lora',
    nameCN: '流萤',
    nameEN: '',
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
    LoRA: [{ ...建LoRA条目(名称), 权重: 0.8 }],
  };
}

  const 工作流 = (ckpt: string) => JSON.stringify({
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: '%prompt%' } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: '%negative_prompt%' } },
  });

  function 建Comfy设置(ckpt: string) {
    const 设置 = 创建默认文生图系统设置();
    设置.启用 = true;
    设置.渠道 = 'comfyui';
    const 档案 = 设置.comfyui.档案列表[设置.comfyui.当前档案];
    档案.连接.地址 = 'http://127.0.0.1:8188';
    档案.工作流Json = 工作流(ckpt);
    设置.comfyui.参考图上传 = false;
    return 设置;
  }

  it('写死的模型不在服务端列表里时报阻塞错误，并给出可用的名字', () => {
    const 结果 = 运行自检(建Comfy设置('不存在的模型.safetensors'), 资源);
    const 项 = 结果.检查项.find((甲) => 甲.标题.includes('工作流里的checkpoint 模型不存在'));
    expect(项?.级别).toBe('error');
    expect(项?.说明).toContain('不存在的模型.safetensors');
    expect(项?.说明).toContain('v1-5-pruned-emaonly.safetensors');
    expect(项?.说明).toContain('Value not in list');
    expect(结果.可出图).toBe(false);
  });

  it('写死的模型确实存在时不报错', () => {
    const 结果 = 运行自检(建Comfy设置('v1-5-pruned-emaonly.safetensors'), 资源);
    expect(标题列表(结果).some((甲) => 甲.includes('不存在'))).toBe(false);
  });

  it('用占位符时跳过校验（说明该值会被设置覆盖）', () => {
    const 结果 = 运行自检(建Comfy设置('%MODEL_NAME%'), 资源);
    expect(标题列表(结果).some((甲) => 甲.includes('不存在'))).toBe(false);
  });

  it('没连上服务端（没有资源列表）时跳过校验，不误报', () => {
    const 结果 = 运行自检(建Comfy设置('不存在的模型.safetensors'), null);
    expect(标题列表(结果).some((甲) => 甲.includes('不存在'))).toBe(false);
  });

  it('服务端没报该类资源时跳过，而不是把全部模型判为不存在', () => {
    const 空资源 = { ...资源, 模型: [] };
    const 结果 = 运行自检(建Comfy设置('任意模型.safetensors'), 空资源);
    expect(标题列表(结果).some((甲) => 甲.includes('不存在'))).toBe(false);
  });

  it('角色绑了 LoRA 但工作流没有槽位占位符时提醒（否则永远不生效）', () => {
    const 设置 = 创建默认文生图系统设置();
    设置.启用 = true;
    设置.渠道 = 'comfyui';
    const 角色 = 建带LoRA的角色('krea.safetensors');
    设置.角色卡 = { [角色.id]: 角色 };
    设置.角色启用列表 = [角色.id];
    const 档案 = 设置.comfyui.档案列表[设置.comfyui.当前档案];
    档案.连接.地址 = 'http://127.0.0.1:8188';
    档案.工作流Json = JSON.stringify({
      1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'a.safetensors' } },
      2: { class_type: 'CLIPTextEncode', inputs: { text: '%prompt%' } },
    });
    const 标题 = 标题列表(运行自检(设置, 资源));
    expect(标题.some((甲) => 甲.includes('没有 LoRA 槽位占位符'))).toBe(true);

    // 工作流里写上槽位后不再报这一条。
    档案.工作流Json = JSON.stringify({
      1: { class_type: 'LoraLoader', inputs: { lora_name: '%lora_name_1%', strength_model: '%lora_weight_1%' } },
      2: { class_type: 'CLIPTextEncode', inputs: { text: '%prompt%' } },
    });
    const 标题2 = 标题列表(运行自检(设置, 资源));
    expect(标题2.some((甲) => 甲.includes('没有 LoRA 槽位占位符'))).toBe(false);
  });

  it('LoRA / VAE / CLIP 同样会被核对', () => {
    const 设置 = 创建默认文生图系统设置();
    设置.启用 = true;
    设置.渠道 = 'comfyui';
    const 档案 = 设置.comfyui.档案列表[设置.comfyui.当前档案];
    档案.连接.地址 = 'http://127.0.0.1:8188';
    档案.工作流Json = JSON.stringify({
      1: { class_type: 'LoraLoader', inputs: { lora_name: '不存在的LoRA.safetensors' } },
      2: { class_type: 'VAELoader', inputs: { vae_name: '不存在的VAE.safetensors' } },
      3: { class_type: 'CLIPTextEncode', inputs: { text: '%prompt%' } },
    });
    设置.comfyui.参考图上传 = false;

    const 结果 = 运行自检(设置, 资源);
    const 标题 = 标题列表(结果);
    expect(标题.some((甲) => 甲.includes('LoRA不存在'))).toBe(true);
    expect(标题.some((甲) => 甲.includes('VAE不存在'))).toBe(true);
  });

  it('工作流不是合法 JSON 时资源校验静默跳过（另有专门检查报错）', () => {
    const 设置 = 建Comfy设置('x');
    (设置.comfyui.档案列表[设置.comfyui.当前档案] as { 工作流Json: string }).工作流Json = '{ 坏 JSON';
    const 结果 = 运行自检(设置, 资源);
    expect(标题列表(结果)).toContain('工作流不是合法 JSON');
  });
});

describe('运行自检：SD 与 Banana', () => {
  it('SD 缺地址时阻塞，并说明需要 --api', () => {
    const 结果 = 运行自检(建设置((项) => {
      项.启用 = true;
      项.渠道 = 'sd';
      项.sd.地址 = '';
    }));
    const 项 = 结果.检查项.find((检查) => 检查.标题 === '没有填 SD WebUI 地址');
    expect(项?.级别).toBe('error');
    expect(项?.说明).toContain('--api');
    expect(结果.可出图).toBe(false);
  });

  it('SD 明说自己没有参考图机制（SD 那一格不是缺口）', () => {
    const 结果 = 运行自检(建设置((项) => {
      项.启用 = true;
      项.渠道 = 'sd';
      项.sd.地址 = 'http://127.0.0.1:7860';
    }));
    expect(标题列表(结果)).toContain('SD 渠道没有参考图机制');
  });

  it('SD 高清放大倍数过大时告警', () => {
    const 结果 = 运行自检(建设置((项) => {
      项.启用 = true;
      项.渠道 = 'sd';
      项.sd.地址 = 'http://a';
      项.sd.高清修复 = true;
      项.sd.高清放大倍数 = 3;
    }));
    expect(标题列表(结果).some((项) => 项.includes('高清放大倍数偏大'))).toBe(true);
  });

  it('Banana 缺 API Key 时阻塞', () => {
    const 结果 = 运行自检(建设置((项) => {
      项.启用 = true;
      项.渠道 = 'banana';
      项.banana.APIKey = '';
    }));
    expect(结果.可出图).toBe(false);
    expect(标题列表(结果)).toContain('没有填 API Key');
  });

  it('Banana 报出实际会请求的两个端点', () => {
    const 结果 = 运行自检(建设置((项) => {
      项.启用 = true;
      项.渠道 = 'banana';
      项.banana.APIKey = 'k';
      项.banana.地址 = 'https://api.openai.com';
      项.banana.参考图上传 = true;
    }));
    const 生成 = 结果.检查项.find((检查) => 检查.标题 === '文生图会请求');
    const 编辑 = 结果.检查项.find((检查) => 检查.标题 === '带参考图时会改请求');
    expect(生成?.说明).toBe('https://api.openai.com/v1/images/generations');
    expect(编辑?.说明).toContain('https://api.openai.com/v1/images/edits');
  });

  it('Banana 说明自己不支持负面词与种子', () => {
    const 结果 = 运行自检(建设置((项) => { 项.启用 = true; 项.渠道 = 'banana'; 项.banana.APIKey = 'k'; }));
    expect(标题列表(结果)).toContain('Banana 不支持负面提示词与种子');
  });
});
