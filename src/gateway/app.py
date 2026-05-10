from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from edu_multi_agent.config import Settings
from edu_multi_agent.llm import LLMClient

from .routers.assistant import router as assistant_router
from .routers.classroom import router as classroom_router
from .routers.code_execution import router as code_execution_router
from .routers.health import router as health_router
from .routers.learner_models import router as learner_models_router
from .routers.prep_runs import router as prep_runs_router
from .routers.practice_review import router as practice_review_router
from .services.classroom_tasks import ClassroomTaskRegistry
from .services.learner_models import LearnerModelRepository, LearnerModelService
from .services.run_registry import RunRegistry


OPENAPI_TAGS = [
    {
        "name": "系统",
        "description": "系统级接口，例如健康检查。",
    },
    {
        "name": "课前准备任务",
        "description": (
            "用于创建课前准备任务、查看任务状态、通过 SSE 观察实时进度，以及下载生成结果。"
        ),
    },
    {
        "name": "选区问答",
        "description": (
            "用于前端选中内容后的即时问答。该类接口通常直接调用大模型并流式返回结果，不创建后台任务。"
        ),
    },
    {
        "name": "AI 课堂",
        "description": (
            "用于把主题/素材/大纲生成成可播放的 AI 课堂数据包，或对课堂讲稿脚本进行解析校验。"
        ),
    },
    {
        "name": "代码运行",
        "description": "用于前端编程题在线运行，例如后端执行 Python 代码。",
    },
    {
        "name": "题目批阅",
        "description": "用于前端在学生提交答案后调用 AI 进行结构化批阅与建议返回。",
    },
    {
        "name": "学习者画像",
        "description": "用于记录学习事件、维护长期学情画像，并向后续教学流程回流。",
    },
]

SWAGGER_UI_PARAMETERS = {
    "defaultModelsExpandDepth": -1,
    "displayRequestDuration": True,
    "docExpansion": "list",
    "deepLinking": True,
    "filter": True,
}


def create_app(
    settings: Settings | None = None,
    *,
    llm_client: LLMClient | None = None,
    classroom_outline_agent: object | None = None,
) -> FastAPI:
    """Create and configure the FastAPI gateway application."""
    resolved_settings = settings or Settings.from_env()
    registry = RunRegistry(resolved_settings)
    resolved_llm_client = llm_client or LLMClient(resolved_settings)
    learner_model_service = LearnerModelService(LearnerModelRepository(resolved_settings))
    classroom_task_registry = ClassroomTaskRegistry(
        resolved_settings,
        resolved_llm_client,
        classroom_outline_agent,
    )

    app = FastAPI(
        title="Edu 多智能体网关 API",
        version="0.2.0",
        summary="面向课前准备多智能体流程的 REST 与 SSE 网关。",
        description=(
            "该网关将基于 LangGraph 的课前准备流程通过 HTTP API、Server-Sent Events (SSE) "
            "以及产物下载接口对外暴露。"
        ),
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        openapi_tags=OPENAPI_TAGS,
        swagger_ui_parameters=SWAGGER_UI_PARAMETERS,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.run_registry = registry
    app.state.settings = resolved_settings
    app.state.llm_client = resolved_llm_client
    app.state.learner_model_service = learner_model_service
    app.state.classroom_outline_agent = classroom_outline_agent
    app.state.classroom_task_registry = classroom_task_registry

    app.include_router(assistant_router)
    app.include_router(classroom_router)
    app.include_router(code_execution_router)
    app.include_router(health_router)
    app.include_router(learner_models_router)
    app.include_router(prep_runs_router)
    app.include_router(practice_review_router)

    @app.get("/docs", include_in_schema=False)
    def redirect_docs() -> RedirectResponse:
        """将旧的 Swagger 地址重定向到新的命名空间路径。"""
        return RedirectResponse(url=app.docs_url or "/api/docs")

    @app.get("/redoc", include_in_schema=False)
    def redirect_redoc() -> RedirectResponse:
        """将旧的 ReDoc 地址重定向到新的命名空间路径。"""
        return RedirectResponse(url=app.redoc_url or "/api/redoc")

    @app.get("/openapi.json", include_in_schema=False)
    def redirect_openapi() -> RedirectResponse:
        """将旧的 OpenAPI 地址重定向到新的命名空间路径。"""
        return RedirectResponse(url=app.openapi_url or "/api/openapi.json")

    return app
