# ontology-factory-pipeline

本体工厂的主流程编排层。

当前能力：

- 默认主线：`preprocess -> wiki_agent(ReAct) -> wiki 数据库`
- 辅助结构化链路：`preprocess -> ner -> relation -> ontology_core -> dls -> storage`

主入口支持：

- Wiki 单文档运行：`run_wiki_pipeline(...)`
- Wiki 目录批量运行：`run_wiki_batch(...)`
- 结构化单文档运行：`run_pipeline(...)`
- 结构化目录批量运行：`run_batch_pipeline(...)`

Wiki 主线每次成功运行会输出：

- 文档级 `clean_text / wiki_document.json`
- 运行级 `run_report.json / page_manifest.json / agent_trace.json`
- 数据库存储 `wiki_pages / wiki_revisions / wiki_links / wiki_page_sources / wiki_runs / wiki_agent_steps`

结构化链路仍然保留，并继续输出：

- 文档级 `clean_text / entities / relations / reconciliation`
- 运行级 `run_report.json / reconciliation_report.json / version_manifest.json`
- 导出级 `canonical_graph.json / canonical_graph.graphml`
