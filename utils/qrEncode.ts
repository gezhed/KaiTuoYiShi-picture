/**
 * 极简二维码编码器（不用第三方依赖）。
 *
 * 只实现本项目需要的子集：字节模式（UTF-8）、纠错级别 M、版本 1–10。
 * 对应容量上限约 213 字节，足以容纳 `http://192.168.x.x:3000/?k=XXXXXXXX`。
 *
 * 算法要点（与 ISO/IEC 18004 一致）：
 *   1. 数据编码：模式指示符 0100 + 字符计数（1–9 版 8 位，10 版起 16 位）+ 数据字节；
 *      补终止符与填充字节（0xEC / 0x11 交替）。
 *   2. 纠错：按版本的「块结构」切分，逐块做 GF(256) 上的 RS 编码，再交织。
 *   3. 矩阵：定位图形、校正图形、时序图形、格式信息、版本信息（≥7），数据按锯齿布点。
 *   4. 掩码：8 种中按 4 条罚分规则选最优。
 */

const 纠错级别M = 0; // 纠错级别 M 的格式位（00）

/** 每版本 [块数, 每块数据码字, 每块纠错码字] 的分组；短块在前（与标准块序一致）。 */
const M块结构: Record<number, Array<[number, number, number]>> = {
  1: [[1, 16, 10]],
  2: [[1, 28, 16]],
  3: [[1, 44, 26]],
  4: [[2, 32, 18]],
  5: [[2, 43, 24]],
  6: [[4, 27, 16]],
  7: [[4, 31, 18]],
  8: [[2, 38, 22], [2, 39, 22]],
  9: [[3, 36, 22], [2, 37, 22]],
  10: [[4, 43, 26], [1, 44, 26]],
};

/** 各版本校正图形的中心坐标。 */
const 校正坐标: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

const 罚分N1 = 3;
const 罚分N2 = 3;
const 罚分N3 = 40;
const 罚分N4 = 10;

const 版本上限 = 10;

function 取位(值: number, 下标: number): boolean {
  return ((值 >>> 下标) & 1) !== 0;
}

/** 版本的总码字数 / 数据码字数 / 纠错码字数。 */
function 版本容量(版本: number): { 总码字: number; 数据码字: number; 纠错码字: number } {
  const 分组 = M块结构[版本];
  let 数据码字 = 0;
  let 纠错 = 0;
  for (const [块数, 每块数据, 每块纠错] of 分组) {
    数据码字 += 块数 * 每块数据;
    纠错 += 块数 * 每块纠错;
  }
  return { 总码字: 数据码字 + 纠错, 数据码字, 纠错码字: 纠错 };
}

// ── GF(256) 纠错 ─────────────────────────────────────────────

const GF指数 = new Uint8Array(256);
const GF对数 = new Uint8Array(256);
(function 初始化伽罗瓦域(): void {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF指数[i] = x;
    GF对数[x] = i;
    x = (x << 1) ^ (x >= 0x80 ? 0x11d : 0);
  }
})();

function 乘法(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF指数[(GF对数[a] + GF对数[b]) % 255];
}

/** 用生成多项式对数据做 RS 编码（多项式长除），返回纠错码字。 */
function 纠错码字(数据: readonly number[], 纠错长度: number): number[] {
  // 生成多项式 ∏ (x - α^i)，最高次在前，首项为 1
  let 生成 = [1];
  for (let i = 0; i < 纠错长度; i += 1) {
    const 下 = new Array<number>(生成.length + 1).fill(0);
    for (let j = 0; j < 生成.length; j += 1) {
      下[j] ^= 生成[j];
      下[j + 1] ^= 乘法(生成[j], GF指数[i]);
    }
    生成 = 下;
  }
  // 消息多项式乘 x^纠错长度，再做长除，余数即纠错码字
  const 消息 = [...数据, ...new Array<number>(纠错长度).fill(0)];
  for (let i = 0; i < 数据.length; i += 1) {
    const 首项 = 消息[i];
    if (首项 === 0) continue;
    for (let j = 0; j < 生成.length; j += 1) {
      消息[i + j] ^= 乘法(生成[j], 首项);
    }
  }
  return 消息.slice(数据.length);
}

// ── 矩阵构造 ────────────────────────────────────────────────

interface 矩阵绘制 {
  size: number;
  /** 模块[y][x]：true = 深色。 */
  模块: boolean[][];
  画功能图形(版本: number, 掩码: number): void;
  画码字(码字: readonly number[]): void;
  涂掩码(掩码: number): void;
  罚分(): number;
}

function 新建矩阵(版本: number): 矩阵绘制 {
  const size = 版本 * 4 + 17;
  const 模块 = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const 功能 = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));

  const 置功能 = (x: number, y: number, 深色: boolean): void => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    模块[y][x] = 深色;
    功能[y][x] = true;
  };

  const 画定位 = (x: number, y: number): void => {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const 距离 = Math.max(Math.abs(dx), Math.abs(dy));
        置功能(x + dx, y + dy, 距离 !== 2 && 距离 !== 4);
      }
    }
  };

  const 画校正 = (x: number, y: number): void => {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        置功能(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  };

  const 画格式信息 = (掩码: number): void => {
    const 数据 = (纠错级别M << 3) | 掩码;
    let 余 = 数据;
    for (let i = 0; i < 10; i += 1) 余 = (余 << 1) ^ ((余 >>> 9) * 0x537);
    const 位 = ((数据 << 10) | 余) ^ 0x5412;

    for (let i = 0; i <= 5; i += 1) 置功能(8, i, 取位(位, i));
    置功能(8, 7, 取位(位, 6));
    置功能(8, 8, 取位(位, 7));
    置功能(7, 8, 取位(位, 8));
    for (let i = 9; i < 15; i += 1) 置功能(14 - i, 8, 取位(位, i));

    for (let i = 0; i < 8; i += 1) 置功能(size - 1 - i, 8, 取位(位, i));
    for (let i = 8; i < 15; i += 1) 置功能(8, size - 15 + i, 取位(位, i));
    置功能(8, size - 8, true);
  };

  const 画版本信息 = (版: number): void => {
    if (版 < 7) return;
    let 余 = 版;
    for (let i = 0; i < 12; i += 1) 余 = (余 << 1) ^ ((余 >>> 11) * 0x1f25);
    const 位 = (版 << 12) | 余;
    for (let i = 0; i < 18; i += 1) {
      const 值 = 取位(位, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      置功能(a, b, 值);
      置功能(b, a, 值);
    }
  };

  const 画功能图形 = (版: number, 掩码: number): void => {
    for (let i = 0; i < size; i += 1) {
      置功能(6, i, i % 2 === 0);
      置功能(i, 6, i % 2 === 0);
    }
    画定位(3, 3);
    画定位(size - 4, 3);
    画定位(3, size - 4);

    const 坐标 = 校正坐标[版];
    const 数量 = 坐标.length;
    for (let i = 0; i < 数量; i += 1) {
      for (let j = 0; j < 数量; j += 1) {
        const 角落 = (i === 0 && j === 0) || (i === 0 && j === 数量 - 1) || (i === 数量 - 1 && j === 0);
        if (!角落) 画校正(坐标[i], 坐标[j]);
      }
    }

    画格式信息(掩码);
    画版本信息(版);
  };

  const 画码字 = (码字: readonly number[]): void => {
    let i = 0;
    for (let 右 = size - 1; 右 >= 1; 右 -= 2) {
      if (右 === 6) 右 = 5;
      for (let 竖 = 0; 竖 < size; 竖 += 1) {
        for (let j = 0; j < 2; j += 1) {
          const x = 右 - j;
          const 向上 = ((右 + 1) & 2) === 0;
          const y = 向上 ? size - 1 - 竖 : 竖;
          if (!功能[y][x] && i < 码字.length * 8) {
            模块[y][x] = 取位(码字[i >>> 3], 7 - (i & 7));
            i += 1;
          }
        }
      }
    }
  };

  const 涂掩码 = (掩码: number): void => {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (功能[y][x]) continue;
        if (本掩码翻转(掩码, x, y)) 模块[y][x] = !模块[y][x];
      }
    }
  };

  const 罚分 = (): number => {
    let 总 = 0;

    for (const 行 of [true, false]) {
      for (let 主线 = 0; 主线 < size; 主线 += 1) {
        let 当前色 = false;
        let 长度 = 0;
        const 历史 = [0, 0, 0, 0, 0, 0, 0];
        for (let 次线 = 0; 次线 < size; 次线 += 1) {
          const 色 = 行 ? 模块[主线][次线] : 模块[次线][主线];
          if (色 === 当前色) {
            长度 += 1;
            if (长度 === 5) 总 += 罚分N1;
            else if (长度 > 5) 总 += 1;
          } else {
            加历史(历史, 长度, 当前色, size);
            if (!当前色) 总 += 计数图案(历史) * 罚分N3;
            当前色 = 色;
            长度 = 1;
          }
        }
        总 += 收尾计数(历史, 长度, 当前色, size) * 罚分N3;
      }
    }

    for (let y = 0; y < size - 1; y += 1) {
      for (let x = 0; x < size - 1; x += 1) {
        const 色 = 模块[y][x];
        if (色 === 模块[y][x + 1] && 色 === 模块[y + 1][x] && 色 === 模块[y + 1][x + 1]) {
          总 += 罚分N2;
        }
      }
    }

    let 深色数 = 0;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) if (模块[y][x]) 深色数 += 1;
    }
    const 总数 = size * size;
    const k = Math.ceil(Math.abs(深色数 * 20 - 总数 * 10) / 总数) - 1;
    总 += k * 罚分N4;

    return 总;
  };

  return { size, 模块, 画功能图形, 画码字, 涂掩码, 罚分 };
}

function 本掩码翻转(掩码: number, x: number, y: number): boolean {
  switch (掩码) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return false;
  }
}

/** 记录一次「颜色翻转前的运行长度」到环形历史；深/浅运行都要记，颜色本身不影响历史值。 */
function 加历史(历史: number[], 长度: number, 深色: boolean, size: number): void {
  void 深色;
  let 值 = 长度;
  if (历史[0] === 0) 值 += size;
  历史.pop();
  历史.unshift(值);
}

function 计数图案(历史: number[]): number {
  const n = 历史[1];
  const 核心 = n > 0 && 历史[2] === n && 历史[3] === n * 3 && 历史[4] === n && 历史[5] === n;
  let 数量 = 0;
  if (核心 && 历史[0] >= n * 4 && 历史[6] >= n) 数量 += 1;
  if (核心 && 历史[6] >= n * 4 && 历史[0] >= n) 数量 += 1;
  return 数量;
}

function 收尾计数(历史: number[], 长度: number, 深色: boolean, size: number): number {
  let 当前 = 长度;
  if (深色) {
    加历史(历史, 当前, true, size);
    当前 = 0;
  }
  当前 += size;
  加历史(历史, 当前, true, size);
  return 计数图案(历史);
}

// ── 对外接口 ────────────────────────────────────────────────

export interface 二维码 {
  size: number;
  /** modules[y][x]：true = 深色。 */
  modules: boolean[][];
}

function 编码为码字(数据: Uint8Array, 版本: number): number[] {
  const 容量 = 版本容量(版本);
  const 位数组: number[] = [];
  const 追加 = (值: number, 长度: number): void => {
    for (let i = 长度 - 1; i >= 0; i -= 1) 位数组.push((值 >>> i) & 1);
  };
  追加(0b0100, 4); // 字节模式
  追加(数据.length, 版本 <= 9 ? 8 : 16);
  for (const 字节 of 数据) 追加(字节, 8);
  const 数据位上限 = 容量.数据码字 * 8;
  for (let i = 0; i < 4 && 位数组.length < 数据位上限; i += 1) 位数组.push(0);
  while (位数组.length % 8 !== 0) 位数组.push(0);
  const 填充 = [0xec, 0x11];
  let 填充下标 = 0;
  while (位数组.length < 数据位上限) {
    追加(填充[填充下标 % 2], 8);
    填充下标 += 1;
  }
  const 码字: number[] = [];
  for (let i = 0; i < 位数组.length; i += 8) {
    let 字节 = 0;
    for (let j = 0; j < 8; j += 1) 字节 = (字节 << 1) | 位数组[i + j];
    码字.push(字节);
  }
  return 码字;
}

function 交织纠错(数据码字: readonly number[], 版本: number): number[] {
  const 分组 = M块结构[版本];
  const 每块长度表: Array<{ 数据: number; 纠错: number }> = [];
  for (const [块数, 每块数据, 每块纠错] of 分组) {
    for (let i = 0; i < 块数; i += 1) 每块长度表.push({ 数据: 每块数据, 纠错: 每块纠错 });
  }
  const 数据块: number[][] = [];
  const 纠错块: number[][] = [];
  let 游标 = 0;
  for (const { 数据, 纠错 } of 每块长度表) {
    const 块 = 数据码字.slice(游标, 游标 + 数据);
    游标 += 数据;
    数据块.push(块);
    纠错块.push(纠错码字(块, 纠错));
  }
  const 结果: number[] = [];
  const 最大数据 = Math.max(...数据块.map((块) => 块.length));
  for (let i = 0; i < 最大数据; i += 1) {
    for (const 块 of 数据块) if (i < 块.length) 结果.push(块[i]);
  }
  const 最大纠错 = Math.max(...纠错块.map((块) => 块.length));
  for (let i = 0; i < 最大纠错; i += 1) {
    for (const 块 of 纠错块) if (i < 块.length) 结果.push(块[i]);
  }
  return 结果;
}

/** 把文本编码成二维码矩阵。文本过长（超出 10 版容量）时返回 null。 */
export function 生成二维码(文本: string): 二维码 | null {
  const 数据 = new TextEncoder().encode(文本);
  let 版本 = 0;
  for (let v = 1; v <= 版本上限; v += 1) {
    const 位 = 4 + (v <= 9 ? 8 : 16) + 数据.length * 8;
    if (位 <= 版本容量(v).数据码字 * 8) {
      版本 = v;
      break;
    }
  }
  if (版本 === 0) return null;

  const 数据码字 = 编码为码字(数据, 版本);
  const 码字 = 交织纠错(数据码字, 版本);

  let 最优: 矩阵绘制 | null = null;
  let 最优罚分 = Infinity;
  for (let 掩码 = 0; 掩码 < 8; 掩码 += 1) {
    const 候选 = 新建矩阵(版本);
    候选.画功能图形(版本, 掩码);
    候选.画码字(码字);
    候选.涂掩码(掩码);
    const 罚分 = 候选.罚分();
    if (罚分 < 最优罚分) {
      最优罚分 = 罚分;
      最优 = 候选;
    }
  }
  if (!最优) return null;
  return { size: 最优.size, modules: 最优.模块 };
}
