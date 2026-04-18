import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight } from 'lucide-react'
import '../App.css'

interface SearchFormData {
    learning_goal: string
    subject: string
    grade_level: string
    learner_profile: string
    notes: string
    language: string
}

const defaultFormData: SearchFormData = {
    learning_goal: '',
    subject: '',
    grade_level: '',
    learner_profile: '',
    notes: '',
    language: '中文',
}

export function HomePage() {
    const [formData, setFormData] = useState<SearchFormData>(defaultFormData)
    const [isDetailOpen, setIsDetailOpen] = useState(false)

    const handleFieldChange = (field: keyof SearchFormData, value: string) => {
        setFormData((prev) => ({
            ...prev,
            [field]: value,
        }))
    }

    const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
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
                            />
                            <button
                                type="submit"
                                className="topbar-search-submit hero-search-submit"
                                aria-label="执行搜索"
                            >
                                <ArrowRight className="hero-search-submit-icon" aria-hidden="true" />
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
                                        />
                                    </label>

                                    <label className="detail-field">
                                        <span>年级</span>
                                        <input
                                            className="detail-field-input"
                                            placeholder="例如：初二 / 高一 / 大一"
                                            value={formData.grade_level}
                                            onChange={(event) => handleFieldChange('grade_level', event.target.value)}
                                        />
                                    </label>

                                    <label className="detail-field detail-field-full">
                                        <span>学生特点</span>
                                        <textarea
                                            className="detail-field-input detail-field-textarea"
                                            placeholder="补充学习者背景、当前水平和目标难点"
                                            value={formData.learner_profile}
                                            onChange={(event) => handleFieldChange('learner_profile', event.target.value)}
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