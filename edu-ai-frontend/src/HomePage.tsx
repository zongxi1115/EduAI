import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import './App.css'

type Topic = '热门' | '个人成长' | '心理' | '健康' | '家庭亲子'

interface StoryCard {
    title: string
    author: string
    pages: string
    excerpt: string
}

interface ChatCompletionResponse {
    choices?: Array<{
        message?: {
            content?: unknown
        }
    }>
    error?: {
        message?: string
    }
}

const topics: Topic[] = ['热门', '个人成长', '心理', '健康', '家庭亲子']

const defaultActiveTopic: Topic = '热门'

const topicSeedKeywords: Record<Topic, string> = {
    热门: '教育热点与学习趋势',
    个人成长: '自我管理与学习方法',
    心理: '情绪调节与心理韧性',
    健康: '作息规律与运动营养',
    家庭亲子: '亲子沟通与家庭教育',
}

const emptyTopicCards: Record<Topic, StoryCard[]> = {
    热门: [],
    个人成长: [],
    心理: [],
    健康: [],
    家庭亲子: [],
}

function getApiConfig() {
    const apiKey = (import.meta.env.VITE_LLM_API_KEY as string | undefined)?.trim() ?? ''
    const model = (import.meta.env.VITE_LLM_MODEL as string | undefined)?.trim() || 'gpt-4.1-mini'
    return { apiKey, model }
}

function flattenMessageContent(content: unknown): string {
    if (typeof content === 'string') {
        return content.trim()
    }
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === 'string') {
                    return part
                }
                if (part && typeof part === 'object') {
                    const value = part as Record<string, unknown>
                    const text = value.text
                    return typeof text === 'string' ? text : ''
                }
                return ''
            })
            .join('\n')
            .trim()
    }
    return ''
}

function cleanJsonCodeBlock(raw: string): string {
    const trimmed = raw.trim()
    if (!trimmed.startsWith('```')) {
        return trimmed
    }

    const lines = trimmed.split('\n')
    if (lines.length < 3) {
        return trimmed
    }

    return lines.slice(1, -1).join('\n').trim()
}

function normalizeCard(input: unknown, index: number): StoryCard | null {
    if (!input || typeof input !== 'object') {
        return null
    }

    const data = input as Record<string, unknown>
    const title = typeof data.title === 'string' ? data.title.trim() : ''
    if (!title) {
        return null
    }

    const author = typeof data.author === 'string' && data.author.trim() ? data.author.trim() : '未知作者'
    const excerpt = typeof data.excerpt === 'string' && data.excerpt.trim() ? data.excerpt.trim() : '暂无摘要'
    const rawPages = data.pages
    const pages = typeof rawPages === 'string' && rawPages.trim() ? rawPages.trim() : `${index + 3}页`

    return {
        title,
        author,
        pages,
        excerpt,
    }
}

function parseCards(rawContent: string): StoryCard[] {
    const cleaned = cleanJsonCodeBlock(rawContent)
    const parseCandidates = [cleaned]
    const left = cleaned.indexOf('[')
    const right = cleaned.lastIndexOf(']')
    if (left >= 0 && right > left) {
        parseCandidates.push(cleaned.slice(left, right + 1))
    }

    for (const candidateText of parseCandidates) {
        try {
            const parsed = JSON.parse(candidateText) as unknown

            let rawCards: unknown[] = []
            if (Array.isArray(parsed)) {
                rawCards = parsed
            } else if (parsed && typeof parsed === 'object') {
                const candidate = parsed as { items?: unknown }
                if (Array.isArray(candidate.items)) {
                    rawCards = candidate.items
                }
            }

            const cards = rawCards
                .map((card, index) => normalizeCard(card, index))
                .filter((card): card is StoryCard => card !== null)
                .slice(0, 3)

            if (cards.length) {
                return cards
            }
        } catch {
            continue
        }
    }

    return []
}

async function fetchTopicCards(topic: Topic, keyword: string): Promise<StoryCard[]> {
    const { apiKey, model } = getApiConfig()
    if (!apiKey) {
        throw new Error('缺少 VITE_LLM_API_KEY，请在前端 .env.local 中配置后重试。')
    }

    const response = await fetch('/api/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            temperature: 0.5,
            messages: [
                {
                    role: 'system',
                    content:
                        '你是教育内容编辑。请只输出 JSON，不要输出任何解释。返回长度为 3 的数组，每一项格式为 {"title":"","author":"","pages":"","excerpt":""}，每条内容都要和指定主题强相关。',
                },
                {
                    role: 'user',
                    content: `请围绕“${topic}”主题，根据关键词“${keyword}”生成 3 条推荐内容。要求题目具体、摘要简洁、适合中学生和大学生阅读。`,
                },
            ],
        }),
    })

    const rawText = await response.text()
    let payload: ChatCompletionResponse = {}
    try {
        payload = JSON.parse(rawText) as ChatCompletionResponse
    } catch {
        if (!response.ok) {
            throw new Error(`API 请求失败（${response.status}）`)
        }
        throw new Error('API 返回内容不是合法 JSON。')
    }

    if (!response.ok) {
        const errorMessage = payload.error?.message || `API 请求失败（${response.status}）`
        throw new Error(errorMessage)
    }

    const content = flattenMessageContent(payload.choices?.[0]?.message?.content)
    const cards = parseCards(content)
    if (!cards.length) {
        throw new Error('API 返回内容无法解析为推荐卡片。')
    }

    return cards
}

export function HomePage() {
    const [activeTopic, setActiveTopic] = useState<Topic>(defaultActiveTopic)
    const [cardsByTopic, setCardsByTopic] = useState<Record<Topic, StoryCard[]>>({ ...emptyTopicCards })
    const [searchValue, setSearchValue] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [statusMessage, setStatusMessage] = useState('输入关键词后回车或点击箭头，更新当前 topic 内容。')
    const [isError, setIsError] = useState(false)

    const visibleCards = useMemo(() => cardsByTopic[activeTopic], [activeTopic, cardsByTopic])

    const requestTopicCards = useCallback(async (topic: Topic, keyword: string) => {
        setIsLoading(true)
        setIsError(false)
        setStatusMessage(`正在请求 API，生成“${topic}”推荐...`)

        try {
            const cards = await fetchTopicCards(topic, keyword)
            setCardsByTopic((previous) => ({
                ...previous,
                [topic]: cards,
            }))
            setStatusMessage(`已更新 ${cards.length} 条“${topic}”内容。`)
        } catch (error) {
            const message = error instanceof Error ? error.message : '更新失败，请稍后重试。'
            setIsError(true)
            setStatusMessage(message)
        } finally {
            setIsLoading(false)
        }
    }, [])

    useEffect(() => {
        void requestTopicCards(defaultActiveTopic, topicSeedKeywords[defaultActiveTopic])
    }, [requestTopicCards])

    const handleSearch = useCallback(async () => {
        const keyword = searchValue.trim() || topicSeedKeywords[activeTopic]
        await requestTopicCards(activeTopic, keyword)
    }, [activeTopic, requestTopicCards, searchValue])

    const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        void handleSearch()
    }

    const handleTopicSelect = useCallback((topic: Topic) => {
        setActiveTopic(topic)
        setIsError(false)

        if (cardsByTopic[topic].length) {
            setStatusMessage(`当前查看“${topic}”内容。`)
            return
        }

        const keyword = searchValue.trim() || topicSeedKeywords[topic]
        void requestTopicCards(topic, keyword)
    }, [cardsByTopic, requestTopicCards, searchValue])

    return (
        <main className="page-shell">
            <div className="ambient ambient-left" aria-hidden="true" />
            <div className="ambient ambient-right" aria-hidden="true" />

            <header className="topbar">
                <div className="brand" aria-label="Edu AI">
                    <span className="brand-mark">E</span>
                    <span className="brand-text">Edu AI</span>
                </div>

                <nav className="nav-pill" aria-label="主导航">
                    <button className="nav-button active" type="button" aria-label="首页">
                        ⌂
                    </button>
                    <button className="nav-button" type="button" aria-label="探索">
                        ◌
                    </button>
                </nav>

                <button className="login-link" type="button">
                    登录
                </button>
            </header>

            <section className="hero">
                <div className="hero-title-wrap">
                    <h1 className="hero-title">
                        今天
                        <span className="hero-highlight">
                            学
                            <span className="hero-highlight-rim" />
                        </span>
                        点啥？
                    </h1>
                </div>

                <div className="search-card">
                    <div className="search-badge">
                        <span className="search-badge-icon">☰</span>
                        <span>讲题</span>
                        <span className="search-badge-new">New</span>
                    </div>

                    <form className="search-field" aria-label="搜索文档或者粘贴网址" onSubmit={handleSearchSubmit}>
                        <input
                            className="search-input"
                            placeholder="学啥都可以，搜索文档 或者 粘贴网址"
                            value={searchValue}
                            onChange={(event) => setSearchValue(event.target.value)}
                            disabled={isLoading}
                        />
                        <span className="search-actions">
                            <button type="button" className="icon-button" aria-label="上传附件">
                                ⎘
                            </button>
                            <button
                                type="submit"
                                className="submit-button"
                                aria-label="开始搜索"
                                disabled={isLoading}
                            >
                                {isLoading ? '…' : '→'}
                            </button>
                        </span>
                    </form>

                    <p className={isError ? 'search-status search-status-error' : 'search-status'}>
                        {statusMessage}
                    </p>
                </div>
            </section>

            <section className="content-section" aria-labelledby="topic-heading">
                <div className="section-head">
                    <div className="topic-tabs" id="topic-heading">
                        {topics.map((topic) => (
                            <button
                                key={topic}
                                type="button"
                                className={topic === activeTopic ? 'topic-tab selected' : 'topic-tab'}
                                onClick={() => handleTopicSelect(topic)}
                                disabled={isLoading}
                            >
                                {topic}
                            </button>
                        ))}
                    </div>
                    <button className="more-link" type="button">
                        查看更多→
                    </button>
                </div>

                <div className="carousel">
                    <button className="carousel-arrow" type="button" aria-label="上一页">
                        ‹
                    </button>

                    <div className="card-grid">
                        {visibleCards.length ? (
                            visibleCards.map((card) => (
                                <article className="story-card" key={`${card.title}-${card.author}`}>
                                    <div className="story-cover" aria-hidden="true">
                                        <div className="paper-sheet" />
                                        <div className="paper-sheet small" />
                                    </div>

                                    <div className="story-copy">
                                        <p className="story-quote">“{card.title}”</p>
                                        <h2>{card.title}</h2>
                                        <div className="meta-row">
                                            <span>{card.author}</span>
                                            <span>•</span>
                                            <span>{card.pages}</span>
                                        </div>
                                        <p className="story-excerpt">{card.excerpt}</p>
                                    </div>
                                </article>
                            ))
                        ) : (
                            <article className="story-card">
                                <div className="story-cover" aria-hidden="true">
                                    <div className="paper-sheet" />
                                    <div className="paper-sheet small" />
                                </div>

                                <div className="story-copy">
                                    <p className="story-quote">“等待生成”</p>
                                    <h2>暂无推荐内容</h2>
                                    <p className="story-excerpt">正在尝试使用 AI 生成当前 topic 的内容，请稍后或换一个关键词重试。</p>
                                </div>
                            </article>
                        )}
                    </div>

                    <button className="carousel-arrow" type="button" aria-label="下一页">
                        ›
                    </button>
                </div>
            </section>

            <button className="assistant-fab" type="button" aria-label="智能助手">
                <span className="assistant-dot" />
            </button>
        </main>
    )
}