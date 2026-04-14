from __future__ import annotations

import ast
from pathlib import Path

from ontology_audit_hub.domain.code.models import CodeCallableSpec, CodeModuleSpec, CodeParameterSpec


def parse_python_modules(paths: list[str]) -> list[CodeModuleSpec]:
    modules: list[CodeModuleSpec] = []
    for path_str in paths:
        path = Path(path_str)
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(path))
        callables: list[CodeCallableSpec] = []
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                callables.append(_build_callable_spec(node, str(path), source))
            elif isinstance(node, ast.ClassDef):
                for child in node.body:
                    if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        callables.append(_build_callable_spec(child, str(path), source, class_name=node.name))
        modules.append(CodeModuleSpec(module_path=str(path), callables=callables))
    return modules


def _build_callable_spec(
    node: ast.FunctionDef | ast.AsyncFunctionDef,
    module_path: str,
    source: str,
    class_name: str | None = None,
) -> CodeCallableSpec:
    qualname = f"{class_name}.{node.name}" if class_name else node.name
    parameters = _extract_parameters(node)
    return_annotation = ast.unparse(node.returns) if node.returns is not None else ""
    source_snippet = (ast.get_source_segment(source, node) or "").strip().splitlines()[0] if source else ""
    return CodeCallableSpec(
        module_path=module_path,
        qualname=qualname,
        name=node.name,
        callable_type="method" if class_name else "function",
        parameters=parameters,
        return_annotation=return_annotation,
        docstring=ast.get_docstring(node) or "",
        source_snippet=source_snippet,
    )


def _extract_parameters(node: ast.FunctionDef | ast.AsyncFunctionDef) -> list[CodeParameterSpec]:
    specs: list[CodeParameterSpec] = []
    positional = list(node.args.posonlyargs) + list(node.args.args)
    defaults = [None] * (len(positional) - len(node.args.defaults)) + list(node.args.defaults)
    for arg, default in zip(positional, defaults, strict=False):
        if arg.arg == "self":
            continue
        specs.append(
            CodeParameterSpec(
                name=arg.arg,
                annotation=ast.unparse(arg.annotation) if arg.annotation is not None else "",
                has_default=default is not None,
                default_repr=ast.unparse(default) if default is not None else None,
            )
        )
    if node.args.vararg is not None:
        specs.append(CodeParameterSpec(name=node.args.vararg.arg, kind="var_positional"))
    for arg, default in zip(node.args.kwonlyargs, node.args.kw_defaults, strict=False):
        specs.append(
            CodeParameterSpec(
                name=arg.arg,
                annotation=ast.unparse(arg.annotation) if arg.annotation is not None else "",
                has_default=default is not None,
                default_repr=ast.unparse(default) if default is not None else None,
                kind="keyword_only",
            )
        )
    if node.args.kwarg is not None:
        specs.append(CodeParameterSpec(name=node.args.kwarg.arg, kind="var_keyword"))
    return specs
