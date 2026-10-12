/**
 * Blob → data URL，纯字节实现，不依赖 `FileReader`。
 *
 * 为什么不用 `FileReader`：它是**宿主环境**的实现，会拿自己 realm 的 `Blob`
 * 做 `instanceof` 校验。而 `fetch(...).blob()` 返回的是运行时（undici）的 Blob，
 * 在某些 Node / jsdom 版本组合下两者不同源，于是抛
 *   Failed to execute 'readAsDataURL' on 'FileReader': parameter 1 is not of type 'Blob'
 *
 * 这个错误只在**测试环境**出现（真实浏览器里同为 realm，不会发生），
 * 但它足够隐蔽：下游朋友拿这份代码去优化时就撞上了 14 个测试失败，
 * 一度被当成产品缺陷。改成读字节再自行编码，跨环境都稳，也顺带少一层异步回调。
 */
export function 字节转Base64(字节: Uint8Array): string {
  let 二进制 = '';
  // 分块拼接：一次性 apply 大数组会爆调用栈（单张 1024x1024 的 PNG 就上兆）。
  const 块 = 0x8000;
  for (let i = 0; i < 字节.length; i += 块) {
    二进制 += String.fromCharCode(...字节.subarray(i, i + 块));
  }
  return btoa(二进制);
}

/** 把 Blob 读成 data URL；空 Blob 返回空串，由调用方决定是否报错。 */
export async function blob转数据地址(blob: Blob): Promise<string> {
  const 字节 = new Uint8Array(await blob.arrayBuffer());
  const mime = blob.type || 'application/octet-stream';
  return `data:${mime};base64,${字节转Base64(字节)}`;
}

/**
 * 把任意来源的 Blob 重新包成本 realm 的 Blob。
 *
 * `FormData.append` 与 `fetch` 的 body 同样会对 Blob 做同源校验，
 * 跨 realm 时抛 `parameter 1/2 is not of type 'Blob'`。经过一次
 * `arrayBuffer()` 重包之后，构造出来的一定是当前 realm 的对象。
 */
export async function 规范化Blob(blob: Blob): Promise<Blob> {
  const 字节 = await blob.arrayBuffer();
  return new Blob([字节], { type: blob.type || 'application/octet-stream' });
}
