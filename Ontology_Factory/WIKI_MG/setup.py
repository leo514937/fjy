from pathlib import Path

from setuptools import find_packages, setup


setup(
    name="wikimg",
    version="0.1.0",
    description="A layered Markdown wiki manager for the command line.",
    long_description=(Path(__file__).parent / "README.md").read_text(encoding="utf-8"),
    long_description_content_type="text/markdown",
    package_dir={"": "src"},
    packages=find_packages(where="src"),
    python_requires=">=3.11",
    entry_points={"console_scripts": ["wikimg=wikimg.cli:main"]},
)
