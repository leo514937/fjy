# ontology-factory-storage

本体工厂 v2.0 的独立本体仓库。

负责统一管理：

- 文档运行记录
- 实体 mention
- 关系 mention
- canonical 实体
- canonical 关系
- 达 / 类 / 私分类历史
- 本体版本
- 变更事件

存储形态：

- SQLite 作为事实源
- 规范图导出为 `JSON + GraphML`
