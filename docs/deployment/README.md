# 部署教程（后端 + 前端）

本文档提供一个可直接落地的部署方案：

- 后端：FastAPI（`edu-prep-api`）
- 前端：Vite 打包后的静态文件
- 网关：Nginx（同域名下将 `/api` 转发到后端）

## 1. 部署前准备

### 服务器依赖

- Python `>=3.10`
- Node.js `>=20`
- pnpm `>=9`
- Nginx（推荐）

### 代码与环境变量

在项目根目录复制环境变量模板：

```bash
cp .env.example .env
```

按实际值修改 `.env`（至少这 3 个必填）：

- `BASE_URL`
- `API_KEY`
- `MODEL_NAME`

可选：

- `OUTPUT_ROOT`
- `TEMPERATURE`
- `REQUEST_TIMEOUT_SECONDS`
- `SUPPORT_VISION`

## 2. 后端部署（FastAPI）

在项目根目录执行：

```bash
python -m pip install -e .
```

启动后端：

```bash
edu-prep-api --host 0.0.0.0 --port 1234
```

健康检查：

```bash
curl http://127.0.0.1:1234/health
```

接口文档：

- `http://127.0.0.1:1234/api/docs`

### systemd 示例（推荐）

文件：`/etc/systemd/system/edu-gateway.service`

```ini
[Unit]
Description=Edu Gateway API
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/edu
EnvironmentFile=/opt/edu/.env
ExecStart=/opt/venv/bin/edu-prep-api --host 0.0.0.0 --port 1234
Restart=always
RestartSec=3
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

生效命令：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now edu-gateway
sudo systemctl status edu-gateway
```

## 3. 前端部署（Vite）

```bash
pnpm --dir edu-ai-frontend install --frozen-lockfile
pnpm --dir edu-ai-frontend build
```

构建产物在：`edu-ai-frontend/dist`

## 4. Nginx 反向代理（同域名部署）

示例配置（请替换域名和路径）：

```nginx
server {
    listen 80;
    server_name your.domain.com;

    root /opt/edu/edu-ai-frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:1234;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 兼容流式接口（SSE）
        proxy_buffering off;
    }

    location = /health {
        proxy_pass http://127.0.0.1:1234/health;
    }
}
```

验证：

1. 打开前端首页可正常加载。
2. 页面发起的 `/api/v1/...` 请求返回正常。
3. `GET /health` 返回 `{"status":"ok", ...}`。

## 5. 常见问题排查

1. 前端报 `404 /api/...`
   - 检查 Nginx 是否配置了 `location /api/` 反代。
   - 检查后端是否监听在 `0.0.0.0:1234`。

2. 后端启动时报缺少环境变量
   - 检查 `.env` 是否存在并包含 `BASE_URL`、`API_KEY`、`MODEL_NAME`。

3. 流式接口无响应或卡住
   - 检查反代是否启用 `proxy_buffering off`。

## 6. GitHub Actions CI/CD

本仓库已接入以下 workflow：

- 后端部署：`.github/workflows/backend-deploy.yml`
  - PR 目标分支为 `main` 且带有 `deploy` label 时触发。
  - fork PR 会自动跳过部署，避免向外部 PR 暴露部署密钥。
  - PR 更新代码后，如果 `deploy` label 仍在，会重新部署该 PR 的最新代码。
  - 也可以手动触发。
  - 通过 SSH + rsync 把仓库同步到服务器，排除前端、`.env`、缓存和输出目录。
  - 在服务器部署目录创建/复用 `.venv`，执行 `python -m pip install -e .`。
  - 默认使用 `https://pypi.tuna.tsinghua.edu.cn/simple` 作为 pip 镜像源。
  - 在服务器执行 `python -m compileall src run_edu_multi_agent.py` 做语法检查。
  - 重启 systemd 服务并访问健康检查地址。

- 前端 Vercel：`.github/workflows/frontend-vercel.yml`
  - PR 触发 Vercel preview deployment。
  - fork PR 不读取仓库 Secrets，会自动跳过预览部署。
  - push 到 `main` 触发 Vercel production deployment。
  - workflow 不执行 `pnpm build`，由 Vercel 云端构建。

### GitHub Secrets

在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions -> Secrets` 配置：

| 名称 | 用途 |
| --- | --- |
| `BACKEND_SSH_HOST` | 后端服务器 IP 或域名，例如 `110.42.248.233` |
| `BACKEND_SSH_USER` | SSH 登录用户 |
| `BACKEND_SSH_KEY` | 私钥内容，公钥需要提前加入服务器 `~/.ssh/authorized_keys` |
| `BACKEND_SSH_PORT` | SSH 端口，可选，默认 `22` |
| `VERCEL_TOKEN` | Vercel API Token |
| `VERCEL_ORG_ID` | Vercel Team/User ID |
| `VERCEL_PROJECT_ID` | Vercel Project ID |

### GitHub Variables

在 `Settings -> Secrets and variables -> Actions -> Variables` 配置：

| 名称 | 默认值 | 用途 |
| --- | --- | --- |
| `BACKEND_DEPLOY_PATH` | `/opt/edu` | 服务器上的后端部署目录 |
| `BACKEND_SERVICE_NAME` | `edu-gateway` | systemd 服务名 |
| `BACKEND_HEALTH_URL` | `http://127.0.0.1:1234/health` | 部署后健康检查地址 |

### 服务器一次性准备

服务器需要先完成这些准备：

```bash
sudo mkdir -p /opt/edu
sudo chown -R "$USER":"$USER" /opt/edu
```

将 GitHub Secret `BACKEND_SSH_KEY` 对应的公钥加入服务器：

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
echo "你的公钥内容" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

生产环境变量文件直接从本地同步到服务器部署目录，CI/CD 不通过 GitHub Secrets 或 Variables 管理 `.env`：

```bash
scp .env ubuntu@110.42.248.233:/opt/edu/.env
ssh ubuntu@110.42.248.233 "chmod 600 /opt/edu/.env"
```

CI/CD 同步时会排除 `.env`，不会覆盖服务器上的生产密钥。部署用户需要能无密码执行：

```bash
sudo systemctl restart edu-gateway
```

### CodeRabbit

仓库根目录已加入 `.coderabbit.yaml`。还需要在 GitHub Marketplace 安装 CodeRabbit App，并授权到这个仓库。授权后，CodeRabbit 会读取该配置，对 PR 自动做中文 review。
