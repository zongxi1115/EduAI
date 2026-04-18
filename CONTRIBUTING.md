# 贡献指南（CONTRIBUTING）

感谢你为本项目贡献代码。为了让协作更稳定，请按下面流程进行。

## 1. 分支与提交流程

1. 不要直接提交到 `main`，请从最新 `main` 拉新分支开发。
2. 分支命名建议：`feat/<topic>`、`fix/<topic>`、`docs/<topic>`。
3. 推送分支后通过 Pull Request 合并，并至少完成 1 次 code review。
4. 尽量保持 PR 小而清晰，避免把多个不相关改动混在一个 PR 里。

## 2. 本地开发前准备

### 后端（Python）

```bash
conda run -n base python -m pip install -e .
```

复制环境变量模板：

```bash
copy .env.example .env
```

### 前端（React + Vite）

```bash
pnpm --dir edu-ai-frontend install
```

## 3. 提交前检查（必做）

### 前端 TypeScript 类型检查（PR Typecheck 核心）

```bash
pnpm --dir edu-ai-frontend typecheck
```

### 前端 Lint

```bash
pnpm --dir edu-ai-frontend lint
```

### 后端基础检查（语法）

```bash
conda run -n base python -m compileall src
```

## 4. PR 要求

1. 使用仓库提供的 PR 模板填写变更背景与验证结果。
2. 在 PR 描述里明确：
   - 做了什么改动；
   - 为什么这样改；
   - 如何验证（命令 + 结果）；
   - 是否有风险和回滚方案。
3. 涉及 UI 变更时，请附截图或录屏。

## 5. 提交信息建议

推荐使用如下前缀：

- `feat:` 新功能
- `fix:` 缺陷修复
- `docs:` 文档调整
- `refactor:` 重构（无行为变化）
- `chore:` 工程化或维护性改动
