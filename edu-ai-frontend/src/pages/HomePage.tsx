import { useCallback, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { Button } from "@/components/ui/button"
import '../App.css'

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

interface SearchFormData {
    learning_goal: string
    subject: string
    grade_level: string
    learner_profile: string
    notes: string
    language: string
}

const defaultTopic = '热门'
const defaultKeyword = '教育热点与学习趋势'
const defaultFormData: SearchFormData = {
    learning_goal: '',
    subject: '',
    grade_level: '',
    learner_profile: '',
    notes: '',
    language: '中文',
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

function createDetailPrompt(topic: string, formData: SearchFormData): string {
    const learningGoal = formData.learning_goal.trim() || defaultKeyword
    const detailLines = [`learning_goal: ${learningGoal}`]

    if (formData.subject.trim()) {
        detailLines.push(`subject: ${formData.subject.trim()}`)
    }
    if (formData.grade_level.trim()) {
        detailLines.push(`grade_level: ${formData.grade_level.trim()}`)
    }
    if (formData.learner_profile.trim()) {
        detailLines.push(`learner_profile: ${formData.learner_profile.trim()}`)
    }
    if (formData.notes.trim()) {
        detailLines.push(`notes: ${formData.notes.trim()}`)
    }

    const language = formData.language.trim() || '中文'
    detailLines.push(`language: ${language}`)

    return `请围绕“${topic}”主题，根据以下字段生成 3 条推荐内容：\n${detailLines.join('\n')}\n要求题目具体、摘要简洁、适合中学生和大学生阅读。`
}

async function fetchTopicCards(topic: string, formData: SearchFormData): Promise<StoryCard[]> {
    const { apiKey, model } = getApiConfig()
    if (!apiKey) {
        throw new Error('缺少 VITE_LLM_API_KEY，请在前端 .env.local 中配置后重试。')
    }

    const userPrompt = createDetailPrompt(topic, formData)

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
                    content: userPrompt,
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
    const [formData, setFormData] = useState<SearchFormData>(defaultFormData)
    const [isDetailOpen, setIsDetailOpen] = useState(false)
    const [isLoading, setIsLoading] = useState(false)

    const handleFieldChange = (field: keyof SearchFormData, value: string) => {
        setFormData((prev) => ({
            ...prev,
            [field]: value,
        }))
    }

    const handleSearch = useCallback(async () => {
        setIsLoading(true)

        try {
            await fetchTopicCards(defaultTopic, formData)
        } catch {
            // ignore request errors on landing page
        } finally {
            setIsLoading(false)
        }
    }, [formData])

    const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        void handleSearch()
    }

    return (
        <main className="page-shell">
            <div className="ambient ambient-left" aria-hidden="true" />
            <div className="ambient ambient-right" aria-hidden="true" />

            <header className="topbar">
                <div className="brand" aria-label="Edu AI">
                    <span className="brand-mark">E</span>
                    <span className="brand-text">Edu AI</span>
                </div>

                <div className="topbar-actions">
                    <button className="login-link" type="button">
                        登录
                    </button>
                </div>
            </header>

            <section className="hero">
                <div className="hero-layout">
                    <aside className="hero-title-side" aria-hidden="true">
                        <div className="hero-title-wrap">
                            <div className="shuimo-title-paper m-rice-paper m-rice-paper-warm" role="img" aria-label="学无止境">
                                <div className="mountains" aria-hidden="true">
                                    <div className="m-m-left">
                                        <div className="m-l-base m-m-reflect" />
                                        <div className="m-l-mid m-m-reflect" />
                                        <div className="m-l-front m-m-reflect" />
                                        <div className="m-l-front-2 m-m-reflect" />
                                    </div>
                                    <div className="m-m-right">
                                        <div className="m-r-base m-m-reflect" />
                                        <div className="m-r-mid m-m-reflect" />
                                        <div className="m-r-front m-m-reflect" />
                                        <div className="m-r-front-2 m-m-reflect" />
                                    </div>
                                </div>

                                <div className="m-rice-paper-hover" aria-hidden="true" />

                                <div className="m-rice-paper-layout">
                                    <h1 className="shuimo-title">
                                        <span className="shuimo-title-char">学</span>
                                        <span className="shuimo-title-char">无</span>
                                        <span className="shuimo-title-char">止</span>
                                        <span className="shuimo-title-char">境</span>
                                    </h1>
                                </div>
                            </div>
                        </div>
                    </aside>

                    <div className="hero-main-column">
                        <form className="topbar-search hero-search" aria-label="搜索主题关键词" onSubmit={handleSearchSubmit}>
                            <input
                                className="topbar-search-input hero-search-input"
                                placeholder="输入学习目标（learning_goal）"
                                value={formData.learning_goal}
                                onChange={(event) => handleFieldChange('learning_goal', event.target.value)}
                                disabled={isLoading}
                            />
                            <button
                                type="submit"
                                className="topbar-search-submit hero-search-submit"
                                aria-label="执行搜索"
                                disabled={isLoading}
                            >
                                {isLoading ? (
                                    <Loader2 className="hero-search-submit-icon hero-search-submit-icon-loading" aria-hidden="true" />
                                ) : (
                                    <ArrowRight className="hero-search-submit-icon" aria-hidden="true" />
                                )}
                            </button>
                        </form>

                        <div className="detail-panel-anchor">
                            <button
                                type="button"
                                className="detail-toggle-btn"
                                onClick={() => setIsDetailOpen((prev) => !prev)}
                                aria-expanded={isDetailOpen}
                                aria-controls="home-detail-fields"
                            >
                                {isDetailOpen ? '收起详细信息' : '输入详细信息'}
                            </button>

                            <div className={`detail-fields-panel${isDetailOpen ? ' is-open' : ''}`} id="home-detail-fields">
                                <div className="detail-fields-grid">
                                    <label className="detail-field">
                                        <span>学科</span>
                                        <input
                                            className="detail-field-input"
                                            placeholder="例如：数学 / 英语 / 物理"
                                            value={formData.subject}
                                            onChange={(event) => handleFieldChange('subject', event.target.value)}
                                            disabled={isLoading}
                                        />
                                    </label>

                                    <label className="detail-field">
                                        <span>年级</span>
                                        <input
                                            className="detail-field-input"
                                            placeholder="例如：初二 / 高一 / 大一"
                                            value={formData.grade_level}
                                            onChange={(event) => handleFieldChange('grade_level', event.target.value)}
                                            disabled={isLoading}
                                        />
                                    </label>

                                    <label className="detail-field detail-field-full">
                                        <span>学生特点</span>
                                        <textarea
                                            className="detail-field-input detail-field-textarea"
                                            placeholder="补充学习者背景、当前水平和目标难点"
                                            value={formData.learner_profile}
                                            onChange={(event) => handleFieldChange('learner_profile', event.target.value)}
                                            disabled={isLoading}
                                            rows={3}
                                        />
                                    </label>

                                    <label className="detail-field detail-field-full">
                                        <span>期望教师特点</span>
                                        <textarea
                                            className="detail-field-input detail-field-textarea"
                                            placeholder="补充额外要求，例如输出风格、时间限制、偏好题型"
                                            value={formData.notes}
                                            onChange={(event) => handleFieldChange('notes', event.target.value)}
                                            disabled={isLoading}
                                            rows={3}
                                        />
                                    </label>

                                    <label className="detail-field">
                                        <span>输出语言</span>
                                        <input
                                            className="detail-field-input"
                                            placeholder=""
                                            value={formData.language}
                                            onChange={(event) => handleFieldChange('language', event.target.value)}
                                            disabled={isLoading}
                                        />
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <button className="assistant-fab" type="button" aria-label="智能助手">
                <span className="assistant-dot" />
            </button>
        </main>
    )
}