## 1️⃣ 环境准备

### 1.1 安装依赖软件

| 软件  | 最低版本 | 下载 / 获取方式 |
|-----|------|-----------|
| **Python** | ≥ 3.10 | [python.org](https://www.python.org/downloads/) 或 Anaconda |
| **Node.js** | ≥ 20 | [nodejs.org](https://nodejs.org/) |
| **pnpm** | ≥ 9  | 安装 Node.js 后运行 `npm install -g pnpm` |
| **Git** | —    | [git-scm.com](https://git-scm.com/) |

### 1.2 验证安装

打开终端（cmd / PowerShell / Terminal），验证安装：

```bash
python --version    # 应输出 Python 3.10+
node --version      # 应输出 v20+
pnpm --version      # 应输出 9+
git --version       # 应输出 git version ...
```


---

## 2️⃣ 克隆项目

```bash
git clone https://github.com/zongxi1115/EduAI.git
cd EduAI
```


---

## 3️⃣ 分支说明与选择

项目的分支结构如下：

| 分支  | 说明  | 新手用哪个？ |
|-----|-----|--------|
| `main` | 稳定主分支（只合并经过 review 的代码） | ❌ 不要直接在上面开发 |
| `**dev**` | **日常开发分支，最新代码** | ✅ 运行**选这个！** |
| `backup/*` | 备份分支 | ❌      |

```bash
git checkout dev
```

> ⚠️ **重要：** 永远不要直接提交到 `main`！如果你要提交自己的修改，请从 `dev` 拉新功能分支开发（如 `feat/my-feature`），完成后提交 Pull Request 合并回 `dev`。


---

## 4️⃣ 配置 API Key

### 4.1 获取 API Key

本项目需要一个大模型 API 作为 AI 引擎，推荐用 **DeepSeek** 或 **OpenAI**：

#### 方案 A：DeepSeek（推荐，便宜且国内可访问）


1. 打开 [platform.deepseek.com](https://platform.deepseek.com/)
2. 注册 / 登录账号
3. 进入 **API Keys** 页面
4. 点击 **"创建 API Key"**，复制生成的 key（如 `sk-xxxxxxxxxxxxxxxx`）

### 4.2 配置环境变量

在项目根目录，复制环境变量模板：

```bash
# Windows (cmd)
copy .env.example .env

# Windows (PowerShell)
Copy-Item .env.example .env

# macOS / Linux
cp .env.example .env
```

用任意编辑器打开 `.env`（**不要提交** `**.env**` **到 Git**，它已被 `.gitignore` 排除）：

### 4.3 填写必填项

`.env` 中找到并修改以下 **3 项必填**：

```ini
# DeepSeek 示例
BASE_URL=https://api.deepseek.com/v1
API_KEY=sk-你的DeepSeek Key粘贴在这里
MODEL_NAME=deepseek-v4-flash
```

### 4.4 选填项说明

| 变量  | 默认值 | 说明  |
|-----|-----|-----|
| `OUTPUT_ROOT` | `outputs` | 生成结果的输出目录 |
| `TEMPERATURE` | `0.2` | 模型温度（创造力），范围 0\~2 |
| `REQUEST_TIMEOUT_SECONDS` | `180` | API 超时秒数 |
| `SUPPORT_VISION` | `true` | 是否支持图片理解 |
| `TTS_*` | —   | 语音合成配置（可选，不配也能用） |
| `DEBUG_DISABLE_VOICE` | `true` | `true` = 关闭语音功能 |
| `AUTH_SECRET` | 同 API_KEY | 用于 Cookie 签名 |
| `ZX_AUTH_*` | —   | 第三方认证配置（可选） |


## 5️⃣ 安装依赖

### 5.1 后端依赖

```bash
# 使用 pip 安装（推荐）
pip install -e .

# 如果想同时安装开发工具（如 pytest），可以：
pip install -e ".[dev]"
```

> ⚠️ 如果你的系统有多个 Python 版本，确保使用的 Python ≥ 3.10：
>
> ```bash
> python3.10 -m pip install -e .
> ```
>
> 如果你用 Anaconda，也可以：
>
> ```bash
> conda run -n base python -m pip install -e .
> ```

### 5.2 前端依赖

```bash
pnpm --dir edu-ai-frontend install --frozen-lockfile
```

> `--frozen-lockfile` 表示使用锁文件中锁定的版本，保证依赖一致性。如果安装失败，可以去掉重试：
>
> ```bash
> pnpm --dir edu-ai-frontend install
> ```


---

## 6️⃣ 运行项目


```bash
# 方式 A：使用项目命令（推荐）
python -m gateway.main --host 127.0.0.1 --port 1234 --reload

# 方式 B：使用 uvicorn 直接启动
python -m uvicorn gateway.main:app --host 127.0.0.1 --port 1234 --reload
```

> `--reload` 表示文件变化时自动重启，开发时很方便。去掉它可用于生产。

启动后打开 **API 文档** 确认：

* Swagger 文档：<http://127.0.0.1:1234/api/docs>
* 健康检查：<http://127.0.0.1:1234/health>


启动前端页面

**新开一个终端窗口**，保持后端运行的同时：

```bash
pnpm --dir edu-ai-frontend dev
```

前端默认运行在 <http://localhost:5173>（Vite 默认端口），打开浏览器访问即可。

## 7️⃣ 校验安装是否成功

### 后端语法检查

```bash
python -m compileall src
```

应输出类似：`Compiling ... OK`，无报错。

### 后端测试

```bash
pip install -e ".[dev]"   # 如果还没装 dev 依赖
python -m pytest -q
```

### 前端 TypeScript 类型检查

```bash
pnpm --dir edu-ai-frontend typecheck
```

### 前端 Lint

```bash
pnpm --dir edu-ai-frontend lint
```


---

## 8️⃣ 常见问题（FAQ）

### Q1: 启动时提示 "Missing required environment variables"

> 没有配置 `.env` 或配置不全。检查 `.env` 文件中 `BASE_URL`、`API_KEY`、`MODEL_NAME` 是否都已填好。

### Q2: API 请求超时 / 连接失败

> 
> 1. 检查 `BASE_URL` 是否写对，如 `https://api.deepseek.com/v1`（注意末尾的 `/v1`）
> 2. 检查网络是否能访问该 API（某些地区可能需要代理）
> 3. 增大 `REQUEST_TIMEOUT_SECONDS` 的值

### Q3: 前端页面打不开 / 白屏

> 
> 1. 确保后端已先启动（前端依赖后端 API）
> 2. 确保前端命令 `pnpm --dir edu-ai-frontend dev` 已在运行
> 3. 检查终端是否有端口冲突报错

### Q4: `pip install -e .` 失败

> * 确保 Python ≥ 3.10
> * 尝试升级 pip：`python -m pip install --upgrade pip`
> * 如果网络慢，可添加国内镜像源：`pip install -e . -i https://pypi.tuna.tsinghua.edu.cn/simple`

### Q5: `pnpm install` 失败

> * 确保 Node.js ≥ 20：`node --version`
> * 确保 pnpm ≥ 9：`pnpm --version`
> * 删除 `node_modules` 后重试：`rm -rf edu-ai-frontend/node_modules && pnpm --dir edu-ai-frontend install`

### Q6: 端口被占用

> 修改启动命令的端口参数：`--port 1235`（比如改成 1235）
>
> 前端如果端口被占用，Vite 会自动提示并询问是否换端口。


---

## 9️⃣ 快速启动速查

```bash
# 1. 克隆项目
git clone https://github.com/zongxi1115/EduAI.git
cd EduAI

# 2. 切换到 dev 分支
git checkout dev

# 3. 配置 API（编辑 .env）
copy .env.example .env
# 用编辑器打开 .env，填上 BASE_URL / API_KEY / MODEL_NAME

# 4. 安装依赖
pip install -e ".[dev]"
pnpm --dir edu-ai-frontend install --frozen-lockfile

# 5. 运行！（二选一）
# 命令行模式：
python run_edu_multi_agent.py --goal "光的折射定律"

# 或者 API + 前端模式（需要开两个终端）：
# 终端 1：
python -m uvicorn gateway.main:app --host 127.0.0.1 --port 1234 --reload
# 终端 2：
pnpm --dir edu-ai-frontend dev
# 浏览器打开 http://localhost:5173
```


---
