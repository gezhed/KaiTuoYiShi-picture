# 第三方组件与许可声明 / Third-party notices

本仓库以 **MIT** 授权发布其自有代码（见根目录 [`LICENSE`](../../LICENSE)），
但**包含源自 st-chatu8（智绘姬）的衍生代码**。因此**发布或分发本作品的整体**时，
必须按 Aladdin Free Public License 第 9 版（下称 AFPL）授权，且**不得收费**。

This repository is released under the **MIT** license for its own code
(see the root [`LICENSE`](../../LICENSE)), but it **contains code derived from
st-chatu8 (智绘姬)**. Distributing the work **as a whole** must therefore be done
under the Aladdin Free Public License, version 9 (AFPL), **at no charge**.

---

## 1. st-chatu8（智绘姬）

| 项目 | 内容 |
| --- | --- |
| 上游 | <https://github.com/damoshen123/st-chatu8> |
| 作者 | 从前跟你一样（GitHub: `damoshen123`）及贡献者 |
| 上游版本 | 3.1.5 |
| 许可 | Aladdin Free Public License, Version 9 |
| 许可全文 | [`third_party/st-chatu8/LICENSE`](./LICENSE)（逐字未改） |

### 1.1 衍生范围

`services/ai/imageGen/` 下的以下模块移植自上游单文件打包产物 `index.js`，
并在移植中改写为 TypeScript：

| 本仓库文件 | 上游来源（`index.js` 行号，版本 3.1.5） |
| --- | --- |
| `workflowTokens.ts` | `PLACEHOLDER_MAP` L46968–L46993；`replacepro` L47103–L47147 |
| `comfyError.ts` | `formatComfyUIApiError` L51011–L51057 |
| `comfyClient.ts` | `utils/comfyuiAdapter.js` L46997–L47075；`utils/comfyui.js` 网络段 L47399–L47680 |
| `comfyGate.ts` | `ComfyUIConcurrencyManager` L10342–L10442；调用点 L47175–L47178 |
| `comfyEngine.ts` | `generateComfyUIImage` L47148–L47705；`comfyuigenerate` L47706–L47760；`processSkippedNodes` L45489–L45592；`handleComfyuiCancel` L47797–L47845 |
| `promptRules.ts` | `splitRuleLine` L9414–L9458；`parseReWrapper` L9407–L9413；`extractIfCondition` L9297–L9322；`evaluateCondition` L9323–L9397；`applyPromptReplaceRules` L9459–L9607；`zhengmian` L9242–L9271；`fumian` L9272–L9296；`stripChineseAnnotations` L9916–L9925 |
| `wordReplacement.ts` | `parseWordReplacementRules` L15958–L15988；`applyWordReplacementRules` L15989–L16025；默认映射 L2470–L2471 |
| `illustrationProtocol.ts` | `parseImagesFromPrompt` L16700–L16838；`convertNewXmlFormatToOld` L16610–L16699；锚点匹配 L16840–L17100 |
| `characterPrompt.ts` | `processCharacterPrompt` L33416–L33658；`normalizeName` L33134；`calculateMatchScore` L33137–L33151；`findBestCharacterMatch` L33232–L33280 |
| `illustrationAgent.ts` | `LLMRequestTypes.IMAGE_GEN` L2409；`handlePromptRequest` L38919；`processImageLikeRequest` L39259；`buildPromptForRequestType` L20924；`buildParseFailureToastInfo` L38471–L38589 |
| `generateIllustration.ts` | `generateComfyUIImage` 提示词段 L47215–L47348；`comfyuigenerate` 落库段 L47706–L47760 |
| `illustrationPipeline.ts` | `insertImagesIntoElement` L16840–L17185；`chat[id].extra.images[swipe_id]` L17541–L17555 |

`models/genSystem.ts` 的类型与默认值来自上游 `utils/config.js` 的 `defaultSettings`
（L2437–L3215）、`utils/characterprompt.js` 的 `CHARACTER_FIELDS`（L33113–L33128）
与 `defaultCharacterSettings`（L24604–L24700）。

### 1.2 各文件的修改声明

AFPL §2(c)(i) 要求在**每个被修改的源文件**中标注修改者、日期与目的。
本仓库的做法是在每个衍生文件的文件头注释里写入：

- 来源文件与上游行号；
- 修改者（KaiTuoYiShi 移植作者）；
- 修改日期；
- 修改目的（改写成 TypeScript、拆分巨型函数、去掉上游的进程级全局与酒馆服务端代理等）。

### 1.3 分发义务（AFPL §2）

分发包含上述代码的作品时，必须同时满足：

1. **整体以 AFPL 授权且免费**（§2(c)(ii)）。不得把包含 AFPL 代码的整体作品
   仅以 MIT 发布，也不得对其收费。
2. **随附完整对应源码**（§2(c)(iv)）——本仓库自身即为该源码。
3. **保留未修改的许可全文**（§1 前言）——即本目录下的 `LICENSE`。
4. **标注修改**（§2(c)(i)）——见 §1.2。
5. **不得附加额外限制**（§2(c)(vi)）；**不得再授权**（§3）。

已废止的做法：把本仓库整体标注为 `"license": "MIT"`。`package.json` 的
`license` 字段因此改为指向本文件。

### 1.4 纯个人使用

AFPL §2(b)：除复制、分发与修改之外的行为不受本许可约束；
**功能性地运行程序不受限制**。因此私自在本地运行不产生分发义务。

---

## 2. 上游 tagData 资产

上游的 `tagData/*.json`（danbooru 词库约 11.6 MB）以 CryptoJS 口令模式 AES 加密，
口令硬编码于上游 `index.js` L93662。**本仓库尚未引入这些资产**。
若后续引入，它们同样属于 AFPL 覆盖范围，须并入本文件的分发义务。

---

## 3. 其他依赖

运行期依赖（React、Vite、zod、lucide-react 等）各自沿用其原始许可，
不受 AFPL 影响，也不影响本作品整体的授权判定——AFPL §2(c) 的「the Work」
指包含或衍生自 AFPL 程序的部分所构成的作品。
