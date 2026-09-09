## v0.7.9（2026-09-09）

### 新增
- 适配 `gpt-image-2.5-sunburst` 和 `gpt-image-2.5-flare` 模型，默认图像模型更新为 `gpt-image-2.5-sunburst`。
- Responses API 新增独立的图像生成模型配置，支持通过设置页和 `?imageGenerationModel=` 查询参数指定；留空时不发送工具模型 ID，保持 API 默认值。
- 支持 `xhigh`、`max` 质量档位，仅适用于 GPT Image 2.5 模型；旧模型自动降为 `high`。

### 变更
- API 模式切换仅更新接口类型，不再自动替换模型 ID。
- GPT Image 2.5 模型识别支持自定义模型 ID，fal.ai 与自定义服务商也可使用 `xhigh`、`max` 质量档位。
