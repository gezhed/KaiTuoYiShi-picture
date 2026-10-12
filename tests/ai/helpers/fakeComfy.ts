// @vitest-environment jsdom
/**
 * 假 ComfyUI 服务端。
 *
 * 存在的理由：占位符替换、工作流提交、历史轮询、出图取回这条链路跨了四个模块，
 * 单元测试各自都过、拼起来仍可能断（例如把工作流字符串传给需要对象的函数、
 * 或轮询查错了 promptId）。这里用一个只实现真实端点的假服务端把整条链路跑通，
 * 不需要真的装 ComfyUI。
 *
 * 它替换 `globalThis.fetch`，按路径分派：/prompt、/history/{id}、/view、
 * /upload/image、/system_stats、/object_info、/api/interrupt、/queue。
 */

export interface 假Comfy记录 {
  /** 收到的全部请求路径（含查询串）。 */
  请求: string[];
  /** 最后一次 /prompt 的请求体。 */
  最后提交: { prompt?: Record<string, unknown>; client_id?: string } | null;
  /** 最后一次 /upload/image 收到的文件名。 */
  最后上传文件名: string | null;
  /** 最后一次 /view 的查询参数。 */
  最后视图参数: URLSearchParams | null;
}

export interface 假Comfy选项 {
  /** 强制 /prompt 返回失败；给字符串时作为错误体。 */
  提交失败?: string | null;
  /** 历史里放什么输出。默认一张 output 类型的 png。 */
  输出?: unknown;
  /** 前 N 次历史查询返回空（模拟排队），之后才给结果。 */
  排队次数?: number;
  /** 出图字节。默认一个最小 PNG 头。 */
  图片字节?: Uint8Array;
}

const 默认图片 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function 安装假ComfyUI(选项: 假Comfy选项 = {}): 假Comfy记录 {
  const 记录: 假Comfy记录 = {
    请求: [],
    最后提交: null,
    最后上传文件名: null,
    最后视图参数: null,
  };
  let 剩余排队次数 = 选项.排队次数 ?? 0;
  let 轮询计数 = 0;

  const 响应 = (体: unknown, 状态 = 200) => new Response(
    typeof 体 === 'string' ? 体 : JSON.stringify(体),
    { status: 状态, headers: { 'content-type': 'application/json' } },
  );

  globalThis.fetch = (async (输入: RequestInfo | URL, 初始化?: RequestInit) => {
    const url = typeof 输入 === 'string' ? 输入 : (输入 instanceof URL ? 输入.toString() : 输入.url);
    记录.请求.push(url);
    const 解析 = new URL(url, 'http://localhost');
    const 路径 = 解析.pathname;

    if (路径 === '/prompt') {
      if (选项.提交失败) return 响应(选项.提交失败, 400);
      记录.最后提交 = JSON.parse(String(初始化?.body ?? '{}')) as 假Comfy记录['最后提交'];
      return 响应({ prompt_id: '任务_1', number: 1, node_errors: {} });
    }

    if (路径.startsWith('/history/')) {
      轮询计数 += 1;
      if (轮询计数 <= 剩余排队次数) return 响应({});
      const promptId = decodeURIComponent(路径.slice('/history/'.length));
      const 输出 = 选项.输出 ?? {
        9: { images: [{ filename: '出图_00001_.png', subfolder: '', type: 'output' }] },
      };
      return 响应({ [promptId]: { prompt: [], outputs: 输出, status: { completed: true } } });
    }

    if (路径 === '/view') {
      记录.最后视图参数 = 解析.searchParams;
      return new Response(选项.图片字节 ?? 默认图片, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }

    if (路径 === '/upload/image') {
      // FormData 里取文件名。
      const 表单 = 初始化?.body;
      if (表单 instanceof FormData) {
        const 文件 = 表单.get('image');
        记录.最后上传文件名 = 文件 instanceof File ? 文件.name : String(表单.get('filename') ?? '');
      }
      return 响应({ name: '已上传.png', subfolder: '', type: 'input' });
    }

    if (路径 === '/system_stats') {
      return 响应({ system: { comfyui_version: '0.0.0-fake' }, devices: [] });
    }

    if (路径 === '/object_info') {
      return 响应({
        CheckpointLoaderSimple: {
          input: { required: { ckpt_name: [['模型A.safetensors', '模型B.safetensors']] } },
        },
        KSampler: {
          input: {
            required: {
              sampler_name: [['euler', 'dpmpp_2m']],
              scheduler: [['normal', 'karras']],
            },
          },
        },
      });
    }

    if (路径 === '/api/interrupt' || 路径 === '/queue') {
      return 响应({});
    }

    return 响应(`未知路径 ${路径}`, 404);
  }) as typeof fetch;

  return 记录;
}

/** 还原真实 fetch。 */
export function 卸载假ComfyUI(): void {
  // jsdom 环境自带 fetch；用 delete 让后续代码回落到宿主实现。
  Reflect.deleteProperty(globalThis, 'fetch');
}
