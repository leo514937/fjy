__all__ = ["XiaoGuGitManager"]


def __getattr__(name: str):
    if name == "XiaoGuGitManager":
        from .manager import XiaoGuGitManager

        return XiaoGuGitManager
    raise AttributeError(name)
