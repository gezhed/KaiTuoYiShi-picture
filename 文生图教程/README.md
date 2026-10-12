# 文生图教程（ComfyUI）

本文件夹放一份可直接用的 ComfyUI 文生图工作流，以及在本应用里接入它的步骤。
更完整的排错清单见 [`docs/文生图-实机验证清单.md`](../docs/文生图-实机验证清单.md)。

## 文件

| 文件 | 说明 |
|---|---|
| `工作流-修正版.json` | **用这个。** 占位符已换成本应用认识的 `%…%` 写法，粘贴进设置即可。 |
| `工作流.json` | 原始版本，提示词位置写的是 `__PROMPT__` / `__NEGATIVE_PROMPT__`，本应用不识别，保留作对照。 |

## 一、先启动 ComfyUI

```bash
python main.py --enable-cors-header
```

不加 `--enable-cors-header`，浏览器直连会被挡，表现为`Failed to fetch`。

在 ComfyUI 里确认 checkpoint 已放进 `models/checkpoints/`，并记住文件名。

## 二、导出工作流

在本文件夹里已经给了一份 API 格式的 JSON，可以直接用。
若要换成自己的工作流：ComfyUI 里点 **Save (API Format)** 导出，
**不要用默认的 Save**——那是 UI 格式，本应用会拒绝。

## 三、在本应用里配置

1. 设置 → 文生图 → **总览**：渠道选 `ComfyUI`，打开「启用文生图」。
2. **ComfyUI** 页：地址填 `http://127.0.0.1:8188` → 点「测试连接」→
   成功后点「读取模型列表」，选一个 checkpoint。
3. **工作流** 页：粘贴 `工作流-修正版.json` 的全部内容。
4. 设置 → 文生图 → **提示词**页点「自检」，红灯全部消掉。

## 四、占位符用法

工作流里想被替换的位置，值写成**带引号的字符串**：

```json
"seed": "%seed%"
```

- 正确：`"seed": "%seed%"` —— 替换后变成裸数字 `"seed": 12345`
- 错误：`"seed": %seed%` —— JSON 本身就不合法，粘贴时就会被拒

常用的几个：

| 占位符 | 含义 |
|---|---|
| `%prompt%` | 正面提示词 |
| `%negative_prompt%` | 负面提示词 |
| `%MODEL_NAME%` | 模型文件名（`ckpt_name`） |
| `%width%` / `%height%` | 宽 / 高 |
| `%seed%` | 种子 |
| `%steps%` | 步数 |
| `%cfg_scale%` | CFG |
| `%sampler_name%` | 采样器 |
| `%scheduler%` | 调度器 |
| `%comfyuicankaotupian%` | 参考图文件名 |

容易写错的：负面词是 `%negative_prompt%`（不是 `%negative%`）、
模型是 `%MODEL_NAME%`（大写）、CFG 是 `%cfg_scale%`（不是 `%cfg%`）。
名字写错**不会报错**，只会留一个没被替换的 `%…%` 在提交体里、出图与正文无关。

## 五、出图

视觉资产 → **手动出图**，填一段提示词点生成，先确认单张能出。
通了再回到「总览」打开「启用正文配图」，并配好「提示词」页的**转化器**（一个可用的 LLM 接口），
这样回复就会自动配图。

## 六、出问题时

| 现象 | 先查 |
|---|---|
| `Failed to fetch` | ComfyUI 有没有加 `--enable-cors-header` |
| 提示工作流是 UI 格式 | 用 Save (API Format) 重新导出 |
| `Value not in list` | 工作流里模型名写死了；换成 `%MODEL_NAME%`，并确认「读取模型列表」里选的和 ComfyUI 里实际存在的模型一致 |
| 出图但提示词没生效 | 提示词位置是不是还在用 `__PROMPT__`；换成 `%prompt%` |
| 提交体里残留 `%…%` | 占位符名拼错了，对照上面表格逐字核对 |
| 一直排队不返回 | ComfyUI 队列是否卡住；默认超时 1800 秒 |

工作流只负责「怎么画」，采样参数、尺寸、模型这些**能设就别写死**，
写成占位符才能在界面上调。
