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
edu-prep-api --host 0.0.0.0 --port 8000
```

健康检查：

```bash
curl http://127.0.0.1:8000/health
```

接口文档：

- `http://127.0.0.1:8000/api/docs`

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
ExecStart=/opt/venv/bin/edu-prep-api --host 0.0.0.0 --port 8000
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
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 兼容流式接口（SSE）
        proxy_buffering off;
    }

    location = /health {
        proxy_pass http://127.0.0.1:8000/health;
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
   - 检查后端是否监听在 `0.0.0.0:8000`。

2. 后端启动时报缺少环境变量
   - 检查 `.env` 是否存在并包含 `BASE_URL`、`API_KEY`、`MODEL_NAME`。

3. 流式接口无响应或卡住
   - 检查反代是否启用 `proxy_buffering off`。
