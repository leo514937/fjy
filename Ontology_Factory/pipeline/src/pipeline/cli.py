from __future__ import annotations

import argparse

from pipeline.runner import run_batch_pipeline, run_pipeline, run_wiki_batch, run_wiki_pipeline


def main() -> int:
    parser = argparse.ArgumentParser(
        description="运行本体工厂 Wiki Agent 主线。默认流程为 preprocess -> wiki_agent(ReAct) -> wiki 数据库；可通过 --mode structured 显式切回结构化链路。"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--input", help="单个输入文档路径。")
    group.add_argument("--input-dir", help="批量输入目录。")
    parser.add_argument("--mode", choices=["wiki", "structured"], default="wiki", help="运行模式，默认 wiki")
    parser.add_argument("--glob", default="*.txt", help="批量模式下使用的 glob，默认 *.txt")
    parser.add_argument("--preprocess-config", required=True, help="preprocess 配置路径")
    parser.add_argument("--pipeline-config", default=None, help="pipeline 配置路径")
    parser.add_argument("--force-reingest", action="store_true", help="即使 content_hash 已存在也重新处理")
    args = parser.parse_args()

    if args.mode == "wiki":
        if args.input_dir:
            result = run_wiki_batch(
                args.input_dir,
                glob=args.glob,
                preprocess_config=args.preprocess_config,
                pipeline_config=args.pipeline_config,
                force_reingest=args.force_reingest,
            )
        else:
            result = run_wiki_pipeline(
                args.input,
                preprocess_config=args.preprocess_config,
                pipeline_config=args.pipeline_config,
                force_reingest=args.force_reingest,
            )
    else:
        if args.input_dir:
            result = run_batch_pipeline(
                args.input_dir,
                glob=args.glob,
                preprocess_config=args.preprocess_config,
                pipeline_config=args.pipeline_config,
                force_reingest=args.force_reingest,
            )
        else:
            result = run_pipeline(
                args.input,
                preprocess_config=args.preprocess_config,
                pipeline_config=args.pipeline_config,
                force_reingest=args.force_reingest,
            )
    print(result.model_dump_json(indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
