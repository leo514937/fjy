import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { PersistentShellSession } from "../../src/tool/shellSession.js";
import {
  getNativeHostShellFixture,
  getPosixHostShellFixture,
  normalizeShellPath,
} from "../helpers/hostShellFixture.js";
import { buildMockSkillResolvedPaths } from "../helpers/mockSkillFixture.js";

async function makeTempDir(prefix: string) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("PersistentShellSession", () => {
  const sessions: PersistentShellSession[] = [];
  const nativeShell = getNativeHostShellFixture();
  const posixShell = getPosixHostShellFixture();

  afterAll(async () => {
    await Promise.all(sessions.map((session) => session.dispose()));
  });

  it("能在持久化 POSIX shell 中跨命令保留 cwd", async () => {
    if (!posixShell) {
      return;
    }

    const root = await makeTempDir("qagent-shell-");
    const child = path.join(root, "child");
    const realRoot = await realpath(root);
    const session = new PersistentShellSession(posixShell.executable, root);
    sessions.push(session);

    await session.execute(posixShell.buildMakeDirectoryCommand(child), { timeoutMs: 10_000 });
    const first = await session.execute(posixShell.printWorkingDirectoryCommand, {
      timeoutMs: 10_000,
    });
    await session.execute(posixShell.buildChangeDirectoryCommand(child), { timeoutMs: 10_000 });
    const second = await session.execute(posixShell.printWorkingDirectoryCommand, {
      timeoutMs: 10_000,
    });
    const firstResolved = await realpath(normalizeShellPath(first.stdout));
    const secondResolved = await realpath(normalizeShellPath(second.stdout));

    expect(firstResolved).toBe(realRoot);
    expect(secondResolved).toBe(path.join(realRoot, "child"));
  });

  it("能通过 POSIX shell 读取项目和全局 skill 资源", async () => {
    if (!posixShell) {
      return;
    }

    const paths = buildMockSkillResolvedPaths();
    const session = new PersistentShellSession(posixShell.executable, paths.projectRoot);
    sessions.push(session);

    const projectSkill = await session.execute(
      posixShell.buildReadFileCommand(
        path.join(paths.projectRoot, ".agent", "skills", "pdf-processing", "SKILL.md"),
      ),
      { timeoutMs: 10_000 },
    );
    const projectReference = await session.execute(
      posixShell.buildReadFileCommand(
        path.join(
          paths.projectRoot,
          ".agent",
          "skills",
          "pdf-processing",
          "references",
          "REFERENCE.md",
        ),
      ),
      { timeoutMs: 10_000 },
    );
    const globalScript = await session.execute(
      posixShell.buildReadFileCommand(
        path.join(paths.globalSkillsDir, "api-testing", "scripts", "request.sh"),
      ),
      { timeoutMs: 10_000 },
    );

    expect(projectSkill.stdout).toContain("name: pdf-processing");
    expect(projectSkill.stdout).toContain("PROJECT BODY MARKER: pdf-processing");
    expect(projectReference.stdout).toContain("PDF Reference");
    expect(globalScript.stdout).toContain("mock api request");
  });

  it("能在原生 shell 中执行命令并正确回报 cwd", async () => {
    const root = await makeTempDir("qagent-native-shell-");
    const realRoot = await realpath(root);
    const session = new PersistentShellSession(nativeShell.executable, root);
    sessions.push(session);

    const result = await session.execute(nativeShell.printWorkingDirectoryCommand, {
      timeoutMs: 10_000,
    });

    expect(await realpath(normalizeShellPath(result.stdout))).toBe(realRoot);
    expect(await realpath(normalizeShellPath(result.cwd))).toBe(realRoot);
  });

  it("能通过原生 shell 保真写入中文文件内容", async () => {
    const root = await makeTempDir("qagent-native-shell-write-");
    const target = path.join(root, "note.txt");
    const session = new PersistentShellSession(nativeShell.executable, root);
    sessions.push(session);

    await session.execute(
      nativeShell.buildWriteFileCommand(
        target,
        ["请默认使用中文回复。", "记录长期偏好。"].join("\n"),
      ),
      { timeoutMs: 10_000 },
    );

    expect(await readFile(target, "utf8")).toContain("请默认使用中文回复。");
    expect(await readFile(target, "utf8")).toContain("记录长期偏好。");
  });

  it("stdout 增量不会泄露内部退出 marker 或伪造换行", async () => {
    if (!posixShell) {
      return;
    }

    const root = await makeTempDir("qagent-shell-stream-");
    const session = new PersistentShellSession(posixShell.executable, root);
    sessions.push(session);
    const chunks: string[] = [];

    const result = await session.execute(
      "printf 'hello'; sleep 0.05; printf 'world'",
      {
        timeoutMs: 10_000,
        onStdoutChunk(chunk) {
          chunks.push(chunk);
        },
      },
    );

    expect(chunks.join("")).toBe("helloworld");
    expect(chunks.join("")).not.toContain("__QAGENT_EXIT__");
    expect(result.stdout).toBe("helloworld");
  });

  it("stderr 会按增量回调透出", async () => {
    if (!posixShell) {
      return;
    }

    const root = await makeTempDir("qagent-shell-stderr-");
    const session = new PersistentShellSession(posixShell.executable, root);
    sessions.push(session);
    const stderrChunks: string[] = [];

    const result = await session.execute(
      "printf 'warn-line' >&2",
      {
        timeoutMs: 10_000,
        onStderrChunk(chunk) {
          stderrChunks.push(chunk);
        },
      },
    );

    expect(stderrChunks.join("")).toContain("warn-line");
    expect(result.stderr).toContain("warn-line");
  });

  it("在 Windows PowerShell 中兼容 cmd 风格的 dir /s /b 目录遍历", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const root = await makeTempDir("qagent-powershell-dir-");
    const nested = path.join(root, "nested");
    const filePath = path.join(nested, "note.txt");
    await mkdir(nested, { recursive: true });
    await writeFile(filePath, "hello", "utf8");

    const session = new PersistentShellSession("powershell.exe", root);
    sessions.push(session);

    const result = await session.execute(`dir /s /b ${path.join(root, "*")}`, {
      timeoutMs: 10_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(filePath);
  });

  it("在 Windows PowerShell 中兼容 cmd 风格的 cd && dir 链式命令", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const root = await makeTempDir("qagent-powershell-chain-");
    const nested = path.join(root, "nested");
    const filePath = path.join(nested, "note.txt");
    await mkdir(nested, { recursive: true });
    await writeFile(filePath, "hello", "utf8");

    const session = new PersistentShellSession("powershell.exe", os.tmpdir());
    sessions.push(session);

    const result = await session.execute(
      `cd ${root} && dir /s /b ${path.join(nested, "*")}`,
      {
        timeoutMs: 10_000,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(await realpath(normalizeShellPath(result.cwd))).toBe(await realpath(root));
    expect(result.stdout).toContain(filePath);
  });
});
