# wiki_agent

本体工厂当前默认主线的 agent-first Wiki 模块。

职责：

- 读取 `preprocess` 后的 clean text
- 在 ReAct 循环中搜索、建页、修页、挂证据、建链接
- 直接把结果写入 SQLite Wiki 后端

核心原则：

- 页面默认按主题页组织，而不是按文档原样建页
- agent 可以直接写 revision
- 所有修改必须可追溯、可回滚
- `ner / relation / canonical` 作为可选工具存在，不是强制前置

主要模块：

- `runtime.py`：ReAct 执行循环
- `tools.py`：文档、Wiki、canonical 辅助工具
- `prompts.py`：topic 规划与 ReAct JSON 协议提示词
- `models.py`：topic、decision、trace、page result 等数据结构
