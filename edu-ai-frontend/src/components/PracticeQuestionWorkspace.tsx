import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronDown, ChevronUp, FileDown, LoaderCircle, Sparkles } from "lucide-react";
import { marked } from "marked";
import katex from "katex";
import katexCssUrl from "katex/dist/katex.min.css?url";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Markdown } from "@/components/ui/markdown";
import { Textarea } from "@/components/ui/textarea";
import { SingleChoiceQuestion } from "@/components/SingleChoiceQuestion";
import { ProgrammingQuestion } from "@/components/ProgrammingQuestion";
import { FillInTheBlanksQuestion } from "@/components/FillInTheBlanksQuestion";
import { ShortAnswerQuestion } from "@/components/ShortAnswerQuestion";
import { DrawingQuestion } from "@/components/DrawingQuestion";

export type PracticeQuestionType =
  | "FillInTheBlank"
  | "MultipleChoice"
  | "ShortAnswer"
  | "Listening"
  | "Coding"
  | "Drawing";

interface PracticeQuestionBase {
  id: string;
  question_type: PracticeQuestionType;
  question: string;
  analysis: string;
  need_ai_judge?: boolean;
  requires_ai_judgment?: boolean;
  skill_tags?: string[];
  difficulty?: number | null;
}

interface FillInTheBlankPracticeQuestion extends PracticeQuestionBase {
  question_type: "FillInTheBlank";
  answer: string;
}

interface MultipleChoicePracticeQuestion extends PracticeQuestionBase {
  question_type: "MultipleChoice";
  options: string[];
  correct_answer: string;
}

interface ShortAnswerPracticeQuestion extends PracticeQuestionBase {
  question_type: "ShortAnswer";
  reference_answer: string;
}

interface ListeningPracticeQuestion extends PracticeQuestionBase {
  question_type: "Listening";
  audio_src: string;
  answer: string;
}

interface CodingPracticeQuestion extends PracticeQuestionBase {
  question_type: "Coding";
  reference_code: string;
  test_cases: unknown[];
}

interface DrawingPracticeQuestion extends PracticeQuestionBase {
  question_type: "Drawing";
  reference_image: string;
}

export type PracticeQuestionRecord =
  | FillInTheBlankPracticeQuestion
  | MultipleChoicePracticeQuestion
  | ShortAnswerPracticeQuestion
  | ListeningPracticeQuestion
  | CodingPracticeQuestion
  | DrawingPracticeQuestion;

type ReviewCorrectness = "correct" | "partially_correct" | "incorrect" | "ungradable";

interface PracticeReviewResponse {
  correctness: ReviewCorrectness;
  score: number;
  summary: string;
  strengths: string[];
  issues: string[];
  review_advice: string[];
  reference_points: string[];
  limitations: string[];
  skill_judgments: Array<{
    skill_id: string;
    display_name: string;
    score: number;
    coverage: number;
    confidence: number;
    reasoning_quality: number;
    misconception_tags: string[];
    observation: string;
  }>;
  learner_observations: string[];
  learner_snapshot?: {
    learner_id: string;
    overall_mastery: number;
    overall_confidence: number;
    overall_band: string;
    total_events: number;
    total_sessions: number;
    strong_skills: string[];
    weak_skills: string[];
    key_misconceptions: string[];
    recommended_focus: string[];
    prompt_profile: string;
    evaluation_summary: string;
    updated_at: string;
  } | null;
  judged_at?: string | null;
}

interface QuestionReviewState {
  status: "submitting" | "completed" | "error";
  mode: "ai" | "local";
  answerPreview: string;
  review?: PracticeReviewResponse;
  error?: string;
}

interface PracticeReviewCapabilitiesResponse {
  support_vision: boolean;
}

interface PracticeQuestionWorkspaceProps {
  learningGoal: string;
  questions: PracticeQuestionRecord[];
  learnerId?: string | null;
  sessionId?: string | null;
  isLoading?: boolean;
  error?: string | null;
  emptyHint?: string;
}

const QUESTION_TYPE_LABELS: Record<PracticeQuestionType, string> = {
  FillInTheBlank: "填空题",
  MultipleChoice: "单选题",
  ShortAnswer: "简答题",
  Listening: "听力题",
  Coding: "编程题",
  Drawing: "作图题",
};

const QUESTION_TYPE_BADGE_CLASS: Record<PracticeQuestionType, string> = {
  FillInTheBlank: "border-amber-200 bg-amber-50 text-amber-700",
  MultipleChoice: "border-sky-200 bg-sky-50 text-sky-700",
  ShortAnswer: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Listening: "border-indigo-200 bg-indigo-50 text-indigo-700",
  Coding: "border-rose-200 bg-rose-50 text-rose-700",
  Drawing: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
};

const PDF_TYPE_ACCENT: Record<PracticeQuestionType, string> = {
  FillInTheBlank: "#b45309",
  MultipleChoice: "#0369a1",
  ShortAnswer: "#047857",
  Listening: "#4338ca",
  Coding: "#be123c",
  Drawing: "#9333ea",
};

const PDF_ANSWER_LINES: Record<PracticeQuestionType, number> = {
  FillInTheBlank: 3,
  MultipleChoice: 2,
  ShortAnswer: 8,
  Listening: 6,
  Coding: 14,
  Drawing: 0,
};

const PDF_SECTION_ORDER: PracticeQuestionType[] = [
  "MultipleChoice",
  "FillInTheBlank",
  "ShortAnswer",
  "Listening",
  "Coding",
  "Drawing",
];

const PDF_SECTION_LABELS: Record<PracticeQuestionType, string> = {
  MultipleChoice: "选择题",
  FillInTheBlank: "填空题",
  ShortAnswer: "简答题",
  Listening: "听力题",
  Coding: "编程题",
  Drawing: "作图题",
};

const PDF_SECTION_NUMBERS = ["一", "二", "三", "四", "五", "六"];

const PDF_PAGE_STYLE = `
  @page {
    size: A4;
    margin: 18mm 16mm;
  }

  .practice-pdf-sheet, .practice-pdf-sheet * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  html, body { background: #ffffff; }

  .practice-pdf-sheet {
    width: 794px;
    box-sizing: border-box;
    background: #ffffff;
    color: #1f2937;
    font-family: "Times New Roman", "SimSun", "宋体", "Songti SC", serif;
    padding: 40px 48px;
    font-size: 14px;
    line-height: 1.7;
  }

  /* ── cover ── */
  .practice-pdf-cover {
    text-align: center;
    padding: 36px 24px 28px;
    margin-bottom: 28px;
    border-bottom: 2px solid #d1d5db;
  }

  .practice-pdf-kicker {
    color: #9ca3af;
    font-family: "Times New Roman", serif;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.3em;
    margin-bottom: 10px;
    text-transform: uppercase;
  }

  .practice-pdf-title {
    color: #111827;
    font-family: "SimHei", "黑体", "Microsoft YaHei", sans-serif;
    font-size: 22px;
    font-weight: 700;
    line-height: 1.4;
    margin: 0 0 4px;
  }

  .practice-pdf-subtitle {
    color: #6b7280;
    font-size: 13px;
    margin-bottom: 20px;
  }

  .practice-pdf-info-grid {
    display: flex;
    flex-wrap: wrap;
    max-width: 400px;
    margin: 0 auto;
    gap: 8px 0;
  }

  .practice-pdf-info-row {
    display: flex;
    align-items: baseline;
    width: 50%;
    gap: 6px;
    font-size: 13px;
    color: #374151;
  }

  .practice-pdf-info-cell {
    display: inline;
  }

  .practice-pdf-info-label {
    color: #9ca3af;
    font-family: "SimHei", "黑体", "Microsoft YaHei", sans-serif;
    flex-shrink: 0;
    min-width: 48px;
  }

  .practice-pdf-info-value {
    flex: 1;
    border-bottom: 1px solid #d1d5db;
    min-width: 100px;
    padding-bottom: 1px;
  }

  .practice-pdf-cover-meta {
    margin-top: 18px;
    font-size: 12px;
    color: #9ca3af;
  }

  /* ── section header ── */
  .practice-pdf-section {
    margin-top: 20px;
    page-break-after: avoid;
  }

  .practice-pdf-section:first-of-type {
    margin-top: 0;
  }

  .practice-pdf-section-title {
    font-family: "SimHei", "黑体", "Microsoft YaHei", sans-serif;
    font-size: 15px;
    font-weight: 700;
    color: #111827;
    border-bottom: 1.5px solid #111827;
    padding-bottom: 5px;
    margin-bottom: 14px;
    letter-spacing: 0.04em;
  }

  /* ── question ── */
  .practice-pdf-question {
    margin-bottom: 16px;
    page-break-inside: avoid;
    break-inside: avoid;
  }

  .practice-pdf-question-title {
    font-size: 14px;
    font-weight: 600;
    color: #1f2937;
    line-height: 1.7;
    margin-bottom: 4px;
  }

  .practice-pdf-question-title .q-badge {
    display: inline-block;
    color: #ffffff;
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 2px;
    vertical-align: middle;
    margin-right: 4px;
    position: relative;
    top: -1px;
  }

  .practice-pdf-question-title .q-diff {
    color: #9ca3af;
    font-size: 11px;
    font-weight: 400;
    margin-left: 6px;
  }

  .practice-pdf-question-body {
    padding-left: 2px;
  }

  /* ── markdown ── */
  .practice-pdf-markdown {
    color: #1f2937;
    font-size: 14px;
    line-height: 1.8;
  }

  .practice-pdf-markdown > :first-child { margin-top: 0; }
  .practice-pdf-markdown > :last-child { margin-bottom: 0; }
  .practice-pdf-markdown p { margin: 0 0 6px; }
  .practice-pdf-markdown ul,
  .practice-pdf-markdown ol { margin: 4px 0 6px 20px; padding: 0; }
  .practice-pdf-markdown li { margin-bottom: 2px; }

  .practice-pdf-markdown pre {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    color: #1f2937;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 12px;
    line-height: 1.55;
    margin: 8px 0;
    padding: 8px 10px;
    white-space: pre-wrap;
  }

  .practice-pdf-markdown code {
    background: #f3f4f6;
    border-radius: 2px;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 12px;
    padding: 1px 3px;
  }

  .practice-pdf-markdown pre code { background: none; padding: 0; }
  .practice-pdf-markdown strong { font-weight: 700; }
  .practice-pdf-markdown em { font-style: italic; }

  /* ── choice options ── */
  .practice-pdf-options {
    margin-top: 6px;
  }

  .practice-pdf-option {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 3px 0;
  }

  .practice-pdf-option-label {
    flex-shrink: 0;
    font-size: 13px;
    font-weight: 600;
    color: #374151;
    min-width: 18px;
  }

  .practice-pdf-option .practice-pdf-markdown {
    font-size: 13px;
    line-height: 1.7;
    flex: 1;
    min-width: 0;
  }

  /* ── option multi-column layouts ── */
  .practice-pdf-options--2col,
  .practice-pdf-options--4col {
    display: flex;
    flex-wrap: wrap;
  }

  .practice-pdf-options--2col > .practice-pdf-option {
    width: 50%;
    box-sizing: border-box;
    padding-right: 8px;
  }

  .practice-pdf-options--4col > .practice-pdf-option {
    width: 25%;
    box-sizing: border-box;
    padding-right: 6px;
  }

  /* ── blank underlines ── */
  .practice-pdf-blank-line {
    display: block;
    margin: 4px 0 2px 0;
    padding-bottom: 2px;
    border-bottom: 1px solid #374151;
    min-height: 1.4em;
  }

  .practice-pdf-blank-inline {
    display: inline-block;
    width: 4em;
    border-bottom: 1px solid #374151;
    vertical-align: baseline;
    height: 0;
    position: relative;
    top: 3px;
    margin: 0 2px;
  }

  .practice-pdf-blank-label {
    color: #9ca3af;
    font-size: 12px;
    margin-right: 4px;
  }

  /* ── answer area ── */
  .practice-pdf-answer {
    margin-top: 10px;
  }

  .practice-pdf-answer-title {
    color: #6b7280;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.06em;
    margin-bottom: 6px;
  }

  .practice-pdf-answer-underline {
    display: inline-block;
    width: 6em;
    height: 0;
    border-bottom: 1px solid #374151;
    vertical-align: baseline;
    margin-left: 4px;
    position: relative;
    top: 2px;
  }

  .practice-pdf-lines {
    /* stacked block divs */
  }

  .practice-pdf-line {
    border-bottom: 1px solid #d1d5db;
    height: 26px;
  }

  .practice-pdf-code-lines {
    background-image: none;
    border: 1px solid #d1d5db;
    min-height: 320px;
    background-color: #ffffff;
  }

  .practice-pdf-code-line {
    height: 24px;
    border-bottom: 1px solid #e5e7eb;
    box-sizing: border-box;
  }

  .practice-pdf-code-line:last-child {
    border-bottom: none;
  }

  .practice-pdf-drawing-box {
    border: 1px dashed #d1d5db;
    min-height: 260px;
  }

  .practice-pdf-note {
    color: #9ca3af;
    font-size: 12px;
    font-style: italic;
    line-height: 1.6;
    margin: 6px 0;
  }

  /* ── KaTeX math ── */
  .practice-pdf-markdown .katex {
    font-size: 1.05em;
  }

  .practice-pdf-markdown .katex-display {
    margin: 10px 0;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .practice-pdf-markdown .katex-display > .katex {
    font-size: 1.15em;
  }

  .practice-pdf-option .katex {
    font-size: 1em;
  }

  @media print {
    .practice-pdf-question { page-break-inside: avoid; }
    .practice-pdf-section-title { page-break-after: avoid; }
  }
`;

const CORRECTNESS_META: Record<
  ReviewCorrectness,
  { label: string; badgeClassName: string; summaryClassName: string }
> = {
  correct: {
    label: "回答正确",
    badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
    summaryClassName: "text-emerald-700",
  },
  partially_correct: {
    label: "部分正确",
    badgeClassName: "border-amber-200 bg-amber-50 text-amber-700",
    summaryClassName: "text-amber-700",
  },
  incorrect: {
    label: "需要改进",
    badgeClassName: "border-rose-200 bg-rose-50 text-rose-700",
    summaryClassName: "text-rose-700",
  },
  ungradable: {
    label: "暂无法判定",
    badgeClassName: "border-border bg-muted/50 text-foreground",
    summaryClassName: "text-foreground",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderPdfMarkdown(markdown: string) {
  // Pre-process: extract LaTeX math before marked mangles underscores etc.
  const mathBlocks: string[] = [];
  let processed = markdown;

  // $$ ... $$ (display math) — must come before single $
  processed = processed.replace(/\$\$([\s\S]+?)\$\$/g, (_match, tex: string) => {
    const idx = mathBlocks.length;
    try {
      mathBlocks.push(
        katex.renderToString(tex.trim(), { throwOnError: false, displayMode: true, strict: "ignore" })
      );
    } catch {
      mathBlocks.push(`<code>$$${escapeHtml(tex.trim())}$$</code>`);
    }
    return `%%MATH_BLOCK_${idx}%%`;
  });

  // $ ... $ (inline math)
  processed = processed.replace(/\$([^\$\n]+?)\$/g, (_match, tex: string) => {
    const idx = mathBlocks.length;
    try {
      mathBlocks.push(
        katex.renderToString(tex.trim(), { throwOnError: false, displayMode: false, strict: "ignore" })
      );
    } catch {
      mathBlocks.push(`<code>$${escapeHtml(tex.trim())}$</code>`);
    }
    return `%%MATH_BLOCK_${idx}%%`;
  });

  let html = marked.parse(processed, {
    async: false,
    breaks: true,
    gfm: true,
  }) as string;

  // Post-process: restore KaTeX HTML
  mathBlocks.forEach((katexHtml, idx) => {
    html = html.replace(new RegExp(`%%MATH_BLOCK_${idx}%%`, "g"), katexHtml);
  });

  // Replace remaining sequences of 2+ underscores with a continuous CSS underline
  html = html.replace(/_{2,}/g, '<span class="practice-pdf-blank-inline"></span>');

  return html;
}

function formatDifficultyLabel(difficulty?: number | null) {
  if (typeof difficulty !== "number") {
    return "";
  }
  return `难度 ${difficulty}`;
}

function sanitizePdfFileName(value: string) {
  const normalized = value.trim().replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "-");
  return normalized ? normalized.slice(0, 48) : "practice-questions";
}

function formatExportDateTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}`;
}

function renderPdfAnswerLines(lineCount: number) {
  return Array.from({ length: lineCount }, () => '<div class="practice-pdf-line"></div>').join("");
}

function renderPdfOptions(question: PracticeQuestionRecord) {
  if (question.question_type !== "MultipleChoice") {
    return "";
  }

  // Estimate plain-text width of each option to decide column layout
  const plainLens = question.options.map((opt) =>
    opt.replace(/[*_~`#>\[\]()!]/g, "").replace(/\$\$[\s\S]+?\$\$/g, "MMM").replace(/\$[^$\n]+?\$/g, "MM").trim().length
  );
  const maxLen = Math.max(...plainLens, 0);
  const totalLen = plainLens.reduce((a, b) => a + b, 0);

  let layoutClass = "";
  if (question.options.length <= 4 && maxLen <= 10 && totalLen <= 40) {
    layoutClass = "practice-pdf-options--4col";
  } else if (question.options.length <= 4 && maxLen <= 20 && totalLen <= 70) {
    layoutClass = "practice-pdf-options--2col";
  }

  return `
    <div class="practice-pdf-options ${layoutClass}">
      ${question.options
        .map((option, index) => {
          const label = String.fromCharCode(65 + index);
          return `
            <div class="practice-pdf-option">
              <span class="practice-pdf-option-label">${label}.</span>
              <div class="practice-pdf-markdown">${renderPdfMarkdown(option)}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderPdfFillInBlankBody(question: PracticeQuestionRecord, mode: "compact" | "loose") {
  if (question.question_type !== "FillInTheBlank" || mode === "compact") {
    return "";
  }
  // Count blanks from raw markdown (before CSS replacement)
  const blankCount = (question.question.match(/_{2,}/g) || []).length || 1;
  const underlines = Array.from({ length: blankCount }, (_, i) =>
    `<span class="practice-pdf-blank-line"><span class="practice-pdf-blank-label">${i + 1}.</span></span>`
  ).join("\n");
  return `
    <div class="practice-pdf-blank-list">${underlines}</div>
  `;
}

function renderPdfAnswerArea(question: PracticeQuestionRecord, mode: "compact" | "loose") {
  if (mode === "compact") {
    return "";
  }

  if (question.question_type === "FillInTheBlank") {
    return "";
  }

  if (question.question_type === "MultipleChoice") {
    return `
      <div class="practice-pdf-answer">
        <div class="practice-pdf-answer-title">答案：<span class="practice-pdf-answer-underline"></span></div>
      </div>
    `;
  }

  if (question.question_type === "Coding") {
    const codeLineCount = PDF_ANSWER_LINES["Coding"] || 14;
    const codeLines = Array.from({ length: codeLineCount }, () =>
      '<div class="practice-pdf-code-line"></div>'
    ).join("");
    return `
      <div class="practice-pdf-answer">
        <div class="practice-pdf-answer-title">作答区</div>
        <div class="practice-pdf-code-lines">${codeLines}</div>
      </div>
    `;
  }

  if (question.question_type === "Drawing") {
    return `
      <div class="practice-pdf-answer">
        <div class="practice-pdf-answer-title">作图区</div>
        <div class="practice-pdf-drawing-box"></div>
      </div>
    `;
  }

  const lineCount = PDF_ANSWER_LINES[question.question_type];
  return `
    <div class="practice-pdf-answer">
      <div class="practice-pdf-answer-title">作答区</div>
      <div class="practice-pdf-lines">${renderPdfAnswerLines(lineCount)}</div>
    </div>
  `;
}

function renderPdfQuestion(question: PracticeQuestionRecord, globalIndex: number, mode: "compact" | "loose") {
  const accent = PDF_TYPE_ACCENT[question.question_type];
  const difficultyLabel = formatDifficultyLabel(question.difficulty);
  const isFillBlank = question.question_type === "FillInTheBlank";

  return `
    <div class="practice-pdf-question">
      <div class="practice-pdf-question-title">
        ${globalIndex}.
        <span class="q-badge" style="background:${accent};">${PDF_SECTION_LABELS[question.question_type]}</span>
        ${difficultyLabel ? `<span class="q-diff">${escapeHtml(difficultyLabel)}</span>` : ""}
      </div>
      <div class="practice-pdf-question-body">
        ${question.question_type === "Listening" ? '<p class="practice-pdf-note">听力题请配合课堂或设备播放音频完成。</p>' : ""}
        <div class="practice-pdf-markdown">${renderPdfMarkdown(question.question)}</div>
        ${isFillBlank ? renderPdfFillInBlankBody(question, mode) : ""}
        ${renderPdfOptions(question)}
        ${renderPdfAnswerArea(question, mode)}
      </div>
    </div>
  `;
}

function buildPracticeQuestionsPdfHtml(
  learningGoal: string,
  questions: PracticeQuestionRecord[],
  generatedAt: Date,
  mode: "compact" | "loose" = "loose",
) {
  const printableLearningGoal = learningGoal.trim() || "练习题";

  const grouped = new Map<PracticeQuestionType, PracticeQuestionRecord[]>();
  for (const q of questions) {
    const list = grouped.get(q.question_type) ?? [];
    list.push(q);
    grouped.set(q.question_type, list);
  }

  let globalIndex = 0;
  const sections = PDF_SECTION_ORDER
    .filter((type) => grouped.has(type))
    .map((type, sectionIdx) => {
      const typeQuestions = grouped.get(type)!;
      const items = typeQuestions
        .map((q) => {
          globalIndex += 1;
          return renderPdfQuestion(q, globalIndex, mode);
        })
        .join("");
      return `
        <section class="practice-pdf-section">
          <h2 class="practice-pdf-section-title">${PDF_SECTION_NUMBERS[sectionIdx]}、${PDF_SECTION_LABELS[type]}</h2>
          ${items}
        </section>
      `;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>${PDF_PAGE_STYLE}</style>
</head>
<body>
  <div class="practice-pdf-sheet">
    <header class="practice-pdf-cover">
      <p class="practice-pdf-kicker">Practice Sheet</p>
      <h1 class="practice-pdf-title">${escapeHtml(printableLearningGoal)}</h1>
      <p class="practice-pdf-subtitle">共 ${questions.length} 题 · ${generatedAt.toLocaleDateString()}</p>
      <div class="practice-pdf-info-grid">
        <div class="practice-pdf-info-row"><span class="practice-pdf-info-label">姓名</span><span class="practice-pdf-info-value">&nbsp;</span></div>
        <div class="practice-pdf-info-row"><span class="practice-pdf-info-label">学号</span><span class="practice-pdf-info-value">&nbsp;</span></div>
        <div class="practice-pdf-info-row"><span class="practice-pdf-info-label">班级</span><span class="practice-pdf-info-value">&nbsp;</span></div>
        <div class="practice-pdf-info-row"><span class="practice-pdf-info-label">日期</span><span class="practice-pdf-info-value">&nbsp;</span></div>
      </div>
    </header>
    ${sections}
  </div>
</body>
</html>`;
}

function formatAnswerPreview(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).join(" / ");
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (value === null || value === undefined) {
    return "";
  }
  return JSON.stringify(value, null, 2);
}

function questionNeedsAIJudge(question: PracticeQuestionRecord) {
  if (typeof question.need_ai_judge === "boolean") {
    return question.need_ai_judge;
  }
  if (typeof question.requires_ai_judgment === "boolean") {
    return question.requires_ai_judgment;
  }
  return (
    question.question_type === "ShortAnswer" ||
    question.question_type === "Coding" ||
    question.question_type === "Drawing"
  );
}

function buildPracticeReviewQuestionPayload(question: PracticeQuestionRecord) {
  const basePayload = {
    id: question.id,
    question_type: question.question_type,
    question: question.question,
    analysis: question.analysis,
    need_ai_judge: questionNeedsAIJudge(question),
    options: [] as string[],
    answer: null as string | null,
    correct_answer: null as string | null,
    reference_answer: null as string | null,
    reference_code: null as string | null,
    test_cases: [] as unknown[],
    audio_src: null as string | null,
    reference_image: null as string | null,
    skill_tags: question.skill_tags ?? [],
    difficulty: question.difficulty ?? null,
  };

  switch (question.question_type) {
    case "FillInTheBlank":
      return { ...basePayload, answer: question.answer };
    case "MultipleChoice":
      return {
        ...basePayload,
        options: question.options,
        correct_answer: question.correct_answer,
      };
    case "ShortAnswer":
      return {
        ...basePayload,
        reference_answer: question.reference_answer,
      };
    case "Listening":
      return {
        ...basePayload,
        answer: question.answer,
        audio_src: question.audio_src,
      };
    case "Coding":
      return {
        ...basePayload,
        reference_code: question.reference_code,
        test_cases: question.test_cases,
      };
    case "Drawing":
      return {
        ...basePayload,
        reference_image: question.reference_image,
      };
    default:
      return basePayload;
  }
}

function splitExpectedBlankAnswers(answer: string, blankCount: number) {
  const normalizedAnswer = answer.trim();
  if (blankCount <= 1) {
    return [normalizedAnswer];
  }

  for (const separator of ["|||", "||", "\n", "；", ";", "，", ",", "、", "|", "/"]) {
    const parts = normalizedAnswer
      .split(separator)
      .map((item) => item.trim())
      .filter(Boolean);
    if (parts.length === blankCount) {
      return parts;
    }
  }

  return Array.from({ length: blankCount }, (_, index) =>
    index === 0 ? normalizedAnswer : ""
  );
}

function buildLocalReview(question: PracticeQuestionRecord, studentAnswer: unknown): PracticeReviewResponse {
  const judgedAt = new Date().toISOString();

  switch (question.question_type) {
    case "FillInTheBlank": {
      const submittedAnswers = Array.isArray(studentAnswer)
        ? studentAnswer.map((item) => String(item ?? "").trim())
        : [String(studentAnswer ?? "").trim()];
      const expectedAnswers = splitExpectedBlankAnswers(question.answer, submittedAnswers.length);
      const totalSlots = Math.max(submittedAnswers.length, expectedAnswers.length, 1);
      let matchCount = 0;

      for (let index = 0; index < totalSlots; index += 1) {
        const submitted = submittedAnswers[index] ?? "";
        const expected = expectedAnswers[index] ?? "";
        if (normalizeText(submitted) === normalizeText(expected) && submitted) {
          matchCount += 1;
        }
      }

      const ratio = matchCount / totalSlots;
      const correctness: ReviewCorrectness =
        ratio === 1 ? "correct" : ratio > 0 ? "partially_correct" : "incorrect";

      return {
        correctness,
        score: Math.round(ratio * 100),
        summary:
          correctness === "correct"
            ? "填空答案正确。"
            : correctness === "partially_correct"
              ? "部分空格填写正确，但还有内容需要核对。"
              : "当前填空答案与参考答案不一致。",
        strengths:
          correctness === "incorrect" ? [] : [`答对 ${matchCount} 个空，说明你已经掌握了一部分关键点。`],
        issues:
          correctness === "correct"
            ? []
            : ["请逐一核对每个空的术语、符号或表达是否与题目要求一致。"],
        review_advice:
          correctness === "correct"
            ? ["可以再回看题目解析，确认自己为什么这样填写。"]
            : ["先对照参考答案检查每个空。", "优先修正拼写、符号和顺序上的偏差。"],
        reference_points: expectedAnswers.map((item, index) => `第 ${index + 1} 空参考：${item || "（未拆分）"}`),
        limitations:
          expectedAnswers.length !== submittedAnswers.length
            ? ["题目标准答案未明确拆分为多空结构，本次判定按顺序近似比对。"]
            : [],
        skill_judgments: [],
        learner_observations: [],
        learner_snapshot: null,
        judged_at: judgedAt,
      };
    }
    case "MultipleChoice": {
      const submitted = String(studentAnswer ?? "").trim();
      const isCorrect =
        normalizeText(submitted) === normalizeText(question.correct_answer) ||
        normalizeText(submitted.replace(/^[A-Z][\.\s、:：-]*/, "")) ===
        normalizeText(question.correct_answer);

      return {
        correctness: isCorrect ? "correct" : "incorrect",
        score: isCorrect ? 100 : 0,
        summary: isCorrect ? "单选题回答正确。" : "当前选择与标准答案不一致。",
        strengths: isCorrect ? ["你选中了正确选项。"] : [],
        issues: isCorrect ? [] : ["建议重新比对题干关键词与各选项差异。"],
        review_advice: isCorrect
          ? ["如果想更扎实，可以再解释一下为什么其他选项不对。"]
          : ["先定位题干中的关键限定词。", "再逐项排除与题意不符的干扰项。"],
        reference_points: [`参考答案：${question.correct_answer}`],
        limitations: [],
        skill_judgments: [],
        learner_observations: [],
        learner_snapshot: null,
        judged_at: judgedAt,
      };
    }
    case "Listening": {
      const submitted = String(studentAnswer ?? "").trim();
      const isCorrect = normalizeText(submitted) === normalizeText(question.answer);

      return {
        correctness: isCorrect ? "correct" : "incorrect",
        score: isCorrect ? 100 : 0,
        summary: isCorrect ? "听力答案匹配参考答案。" : "听力答案与参考答案暂不一致。",
        strengths: isCorrect ? ["你抓住了听力中的关键信息。"] : [],
        issues: isCorrect ? [] : ["可以回放音频，重点关注容易混淆的关键词和细节信息。"],
        review_advice: isCorrect
          ? ["可以尝试复述原句，进一步巩固听辨能力。"]
          : ["回放一遍音频并记录关键词。", "核对数字、专有名词或否定词是否听漏。"],
        reference_points: [`参考答案：${question.answer}`],
        limitations: [],
        skill_judgments: [],
        learner_observations: [],
        learner_snapshot: null,
        judged_at: judgedAt,
      };
    }
    default:
      return {
        correctness: "ungradable",
        score: 0,
        summary: "这道题当前无法进行本地自动判题。",
        strengths: [],
        issues: ["缺少足够的结构化规则来直接判断本次提交。"],
        review_advice: ["请开启 AI 批阅，或补充更明确的标准答案结构。"],
        reference_points: [],
        limitations: ["当前前端只对部分客观题提供本地判题。"],
        skill_judgments: [],
        learner_observations: [],
        learner_snapshot: null,
        judged_at: judgedAt,
      };
  }
}

function parseQuestion(item: unknown): PracticeQuestionRecord | null {
  if (!isRecord(item)) {
    return null;
  }

  const id = typeof item.id === "string" ? item.id : "";
  const question = typeof item.question === "string" ? item.question : "";
  const analysis = typeof item.analysis === "string" ? item.analysis : "";
  const questionType = item.question_type;
  const needAIJudge =
    typeof item.need_ai_judge === "boolean"
      ? item.need_ai_judge
      : typeof item.requires_ai_judgment === "boolean"
        ? item.requires_ai_judgment
        : undefined;
  const requiresAIJudgment =
    typeof item.requires_ai_judgment === "boolean" ? item.requires_ai_judgment : undefined;

  if (!id || !question || !analysis || typeof questionType !== "string") {
    return null;
  }

  const commonFields = {
    id,
    question,
    analysis,
    need_ai_judge: needAIJudge,
    requires_ai_judgment: requiresAIJudgment,
    skill_tags: isStringArray(item.skill_tags) ? item.skill_tags : undefined,
    difficulty: typeof item.difficulty === "number" ? item.difficulty : undefined,
  };

  switch (questionType as PracticeQuestionType) {
    case "FillInTheBlank":
      if (typeof item.answer !== "string") {
        return null;
      }
      return { ...commonFields, question_type: "FillInTheBlank", answer: item.answer };
    case "MultipleChoice":
      if (!isStringArray(item.options) || typeof item.correct_answer !== "string") {
        return null;
      }
      return {
        ...commonFields,
        question_type: "MultipleChoice",
        options: item.options,
        correct_answer: item.correct_answer,
      };
    case "ShortAnswer":
      if (typeof item.reference_answer !== "string") {
        return null;
      }
      return {
        ...commonFields,
        question_type: "ShortAnswer",
        reference_answer: item.reference_answer,
      };
    case "Listening":
      if (typeof item.audio_src !== "string" || typeof item.answer !== "string") {
        return null;
      }
      return {
        ...commonFields,
        question_type: "Listening",
        audio_src: item.audio_src,
        answer: item.answer,
      };
    case "Coding":
      if (typeof item.reference_code !== "string" || !Array.isArray(item.test_cases)) {
        return null;
      }
      return {
        ...commonFields,
        question_type: "Coding",
        reference_code: item.reference_code,
        test_cases: item.test_cases,
      };
    case "Drawing":
      if (typeof item.reference_image !== "string") {
        return null;
      }
      return {
        ...commonFields,
        question_type: "Drawing",
        reference_image: item.reference_image,
      };
    default:
      return null;
  }
}

export function parsePracticeQuestionsPayload(payload: unknown): PracticeQuestionRecord[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((item) => parseQuestion(item))
    .filter((item): item is PracticeQuestionRecord => item !== null);
}

function guessProgrammingLanguage(referenceCode: string) {
  const source = referenceCode.trim();

  if (/^\s*def\s+\w+\s*\(/m.test(source)) {
    return "python";
  }
  if (
    /^\s*(function\s+\w+\s*\(|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=)/m.test(source)
  ) {
    return "javascript";
  }
  if (/^\s*public\s+class\s+\w+/m.test(source) || /System\.out\.println/.test(source)) {
    return "java";
  }
  if (/^\s*#include\s*</m.test(source) || /std::/.test(source)) {
    return "cpp";
  }

  return "plaintext";
}

function extractCallableName(referenceCode: string, language: string) {
  if (language === "python") {
    return referenceCode.match(/^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/m)?.[1] ?? "";
  }
  if (language === "javascript") {
    return (
      referenceCode.match(/^\s*function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/m)?.[1] ??
      referenceCode.match(/^\s*(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*function/m)?.[1] ??
      referenceCode.match(/^\s*(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*\(/m)?.[1] ??
      ""
    );
  }

  return "";
}

function buildStarterCode(referenceCode: string, language: string) {
  if (language === "python") {
    const signature = referenceCode.match(/^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\((.*?)\)\s*:/m);
    if (signature) {
      return `def ${signature[1]}(${signature[2]}):\n    pass`;
    }
    return "# 在这里编写你的解法\n";
  }

  if (language === "javascript") {
    const functionSignature = referenceCode.match(
      /^\s*function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\((.*?)\)/m
    );
    if (functionSignature) {
      return `function ${functionSignature[1]}(${functionSignature[2]}) {\n  \n}`;
    }

    const assignmentSignature = referenceCode.match(
      /^\s*(const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*function\s*\((.*?)\)/m
    );
    if (assignmentSignature) {
      return `${assignmentSignature[1]} ${assignmentSignature[2]} = function(${assignmentSignature[3]}) {\n  \n};`;
    }

    const arrowSignature = referenceCode.match(
      /^\s*(const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*\((.*?)\)\s*=>/m
    );
    if (arrowSignature) {
      return `${arrowSignature[1]} ${arrowSignature[2]} = (${arrowSignature[3]}) => {\n  \n};`;
    }

    return "// 在这里编写你的解法\n";
  }

  return "";
}

function toJavaScriptLiteral(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value) || isRecord(value)) {
    return JSON.stringify(value, null, 2);
  }
  return "undefined";
}

function toPythonLiteral(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "None";
  }
  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }
  if (value === null) {
    return "None";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => toPythonLiteral(item)).join(", ")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .map(([key, entryValue]) => `${JSON.stringify(key)}: ${toPythonLiteral(entryValue)}`)
      .join(", ")}}`;
  }
  return "None";
}

function buildRunnerCode(question: CodingPracticeQuestion, language: string) {
  const callableName = extractCallableName(question.reference_code, language);
  const firstCase = Array.isArray(question.test_cases) ? question.test_cases[0] : null;
  if (!callableName || !Array.isArray(firstCase) || firstCase.length === 0) {
    return "";
  }

  const rawInput = firstCase[0];
  const args = Array.isArray(rawInput)
    ? rawInput
      .map((item) =>
        language === "python" ? toPythonLiteral(item) : toJavaScriptLiteral(item)
      )
      .join(", ")
    : language === "python"
      ? toPythonLiteral(rawInput)
      : toJavaScriptLiteral(rawInput);

  if (language !== "javascript" && language !== "python") {
    return "";
  }

  return `return ${callableName}(${args});`;
}

function ListeningQuestionCard({
  question,
  onSubmit,
}: {
  question: ListeningPracticeQuestion;
  onSubmit?: (answer: string) => void;
}) {
  const [answer, setAnswer] = useState("");

  return (
    <Card className="border shadow-sm">
      <CardContent className="p-6 space-y-5">
        <div className="space-y-3">
          <div className="prose prose-slate max-w-none">
            <Markdown>{question.question}</Markdown>
          </div>
          {question.audio_src.trim() ? (
            <audio controls className="w-full">
              <source src={question.audio_src} />
              当前浏览器不支持音频播放。
            </audio>
          ) : (
            <div className="rounded-xl border border-dashed bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
              当前题目没有可直接播放的音频地址。
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">作答区</p>
          <Textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="请输入你的听力答案..."
            className="min-h-32 resize-y"
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={() => (onSubmit ? onSubmit(answer) : window.alert(`已提交答案：\n${answer || "（空）"}`))}>
            提交答案
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function QuestionReviewPanel({ state }: { state?: QuestionReviewState }) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    setIsCollapsed(false);
  }, [state?.status, state?.answerPreview, state?.review?.judged_at]);

  if (!state) {
    return null;
  }

  if (state.status === "submitting") {
    return (
      <Card className="border-primary/15 bg-primary/5 shadow-sm">
        <CardContent className="flex items-start gap-3 p-5">
          <LoaderCircle className="mt-0.5 h-4 w-4 animate-spin text-primary" />
          <div className="space-y-1.5 text-sm">
            <p className="font-medium text-foreground">
              {state.mode === "ai" ? "AI 正在批阅这道题..." : "正在进行自动判题..."}
            </p>
            {state.answerPreview ? (
              <p className="text-muted-foreground">已提交：{state.answerPreview}</p>
            ) : (
              <p className="text-muted-foreground">已收到本次提交，正在生成反馈。</p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (state.status === "error") {
    return (
      <Card className="border-rose-200 bg-rose-50 shadow-sm">
        <CardContent className="space-y-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 text-rose-600" />
              <div className="space-y-1.5 text-sm">
                <p className="font-medium text-rose-700">批阅失败</p>
                {!isCollapsed ? (
                  <p className="text-rose-600">{state.error || "提交后暂时无法返回结果，请稍后重试。"}</p>
                ) : null}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-full px-3 text-rose-700 hover:bg-rose-100 hover:text-rose-800"
              onClick={() => setIsCollapsed((previous) => !previous)}
            >
              {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              <span className="ml-1">{isCollapsed ? "展开" : "收起"}</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!state.review) {
    return null;
  }

  const meta = CORRECTNESS_META[state.review.correctness];

  return (
    <Card className="border shadow-sm">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="rounded-full px-3 py-1">
              {state.mode === "ai" ? "AI 批阅" : "自动判题"}
            </Badge>
            <Badge variant="outline" className={meta.badgeClassName}>
              {meta.label}
            </Badge>
            <Badge variant="outline" className="border-border bg-muted/50 text-foreground">
              {state.review.score} 分
            </Badge>
            {state.review.judged_at ? (
              <span className="text-xs text-muted-foreground">{new Date(state.review.judged_at).toLocaleString()}</span>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-full px-3 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => setIsCollapsed((previous) => !previous)}
          >
            {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            <span className="ml-1">{isCollapsed ? "展开" : "收起"}</span>
          </Button>
        </div>

        <div className="space-y-1">
          <p className={`text-sm font-semibold ${meta.summaryClassName}`}>{state.review.summary}</p>
          {state.answerPreview ? <p className="text-sm text-muted-foreground">你的提交：{state.answerPreview}</p> : null}
        </div>

        {!isCollapsed && state.review.review_advice.length > 0 ? (
          <div className="rounded-2xl border border-primary/10 bg-primary/5 px-4 py-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
              <Sparkles className="h-4 w-4" />
              审阅建议
            </div>
            <ul className="space-y-1 text-sm text-foreground">
              {state.review.review_advice.map((item, index) => (
                <li key={`${item}-${index}`}>- {item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {!isCollapsed && state.review.strengths.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">做得好的地方</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {state.review.strengths.map((item, index) => (
                <li key={`${item}-${index}`}>- {item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {!isCollapsed && state.review.issues.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">还需要关注</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {state.review.issues.map((item, index) => (
                <li key={`${item}-${index}`}>- {item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {!isCollapsed && state.review.reference_points.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">参考要点</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {state.review.reference_points.map((item, index) => (
                <li key={`${item}-${index}`}>- {item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {!isCollapsed && state.review.limitations.length > 0 ? (
          <div className="rounded-2xl border border-border bg-muted/50 px-4 py-3">
            <p className="mb-2 text-sm font-medium text-foreground">判定说明</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {state.review.limitations.map((item, index) => (
                <li key={`${item}-${index}`}>- {item}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function renderQuestionCard(
  question: PracticeQuestionRecord,
  onSubmitQuestion: (
    question: PracticeQuestionRecord,
    studentAnswer: unknown,
    submissionContext?: Record<string, unknown>
  ) => void
) {
  switch (question.question_type) {
    case "FillInTheBlank":
      return (
        <FillInTheBlanksQuestion
          questionContent={question.question}
          onSubmit={(answers) => onSubmitQuestion(question, answers)}
        />
      );
    case "MultipleChoice":
      return (
        <SingleChoiceQuestion
          questionContent={question.question}
          options={question.options.map((content, index) => ({
            id: String.fromCharCode(65 + index),
            content,
          }))}
          onSelect={(optionId) => {
            const optionIndex = optionId.charCodeAt(0) - 65;
            const selectedContent = question.options[optionIndex] ?? optionId;
            onSubmitQuestion(question, selectedContent, {
              selected_option_id: optionId,
              selected_option_content: selectedContent,
            });
          }}
        />
      );
    case "ShortAnswer":
      return (
        <ShortAnswerQuestion
          questionContent={question.question}
          onSubmit={(answer) => onSubmitQuestion(question, answer)}
        />
      );
    case "Listening":
      return <ListeningQuestionCard question={question} onSubmit={(answer) => onSubmitQuestion(question, answer)} />;
    case "Coding": {
      const language = guessProgrammingLanguage(question.reference_code);
      return (
        <ProgrammingQuestion
          questionContent={question.question}
          language={language}
          initialCode={buildStarterCode(question.reference_code, language)}
          initialRunnerCode={buildRunnerCode(question, language)}
          onSubmit={(code) =>
            onSubmitQuestion(question, code, {
              language,
            })
          }
        />
      );
    }
    case "Drawing": {
      const referenceHint = question.reference_image.trim()
        ? `\n\n参考图示提示：${question.reference_image}`
        : "";
      return (
        <DrawingQuestion
          questionContent={`${question.question}${referenceHint}`}
          onSubmit={(submission) =>
            onSubmitQuestion(
              question,
              submission.hasDrawingContent ? "学生已提交作图答案。" : "学生提交了空白或未完成的画板。",
              {
                drawing_submitted: true,
                drawing_has_content: submission.hasDrawingContent,
                drawing_image_data_url: submission.imageDataUrl,
              }
            )
          }
        />
      );
    }
    default:
      return null;
  }
}

export function PracticeQuestionWorkspace({
  learningGoal,
  questions,
  learnerId,
  sessionId,
  isLoading = false,
  error,
  emptyHint = "当前还没有可展示的练习题，请等待题库生成完成。",
}: PracticeQuestionWorkspaceProps) {
  const [reviewStates, setReviewStates] = useState<Record<string, QuestionReviewState>>({});
  const [reviewCapabilities, setReviewCapabilities] =
    useState<PracticeReviewCapabilitiesResponse | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [exportPdfError, setExportPdfError] = useState<string | null>(null);
  const [pdfLayoutMode, setPdfLayoutMode] = useState<"compact" | "loose">("loose");

  const typeCounts = useMemo(() => {
    return questions.reduce<Record<PracticeQuestionType, number>>(
      (result, question) => {
        result[question.question_type] += 1;
        return result;
      },
      {
        FillInTheBlank: 0,
        MultipleChoice: 0,
        ShortAnswer: 0,
        Listening: 0,
        Coding: 0,
        Drawing: 0,
      }
    );
  }, [questions]);

  const summaryBadges = useMemo(
    () =>
      (Object.entries(typeCounts) as Array<[PracticeQuestionType, number]>).filter(
        ([, count]) => count > 0
      ),
    [typeCounts]
  );

  const loadReviewCapabilities = async () => {
    try {
      const response = await fetch("/api/v1/practice-review/capabilities", {
        headers: {
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        throw new Error(`获取批阅能力失败（${response.status}）`);
      }
      const capabilities = (await response.json()) as PracticeReviewCapabilitiesResponse;
      setReviewCapabilities(capabilities);
      return capabilities;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    void loadReviewCapabilities();
  }, []);

  const persistReviewedEvent = async (
    question: PracticeQuestionRecord,
    studentAnswer: unknown,
    submissionContext: Record<string, unknown>,
    review: PracticeReviewResponse,
    source: "practice_review_ai" | "practice_review_local"
  ) => {
    if (!learnerId?.trim()) {
      return;
    }

    try {
      await fetch("/api/v1/learner-models/ingest-review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          learner_id: learnerId,
          session_id: sessionId ?? null,
          source,
          learning_goal: learningGoal,
          question: buildPracticeReviewQuestionPayload(question),
          student_answer: studentAnswer,
          submission_context: submissionContext,
          review,
        }),
      });
    } catch {
      // Keep the visible review result even if background persistence fails.
    }
  };

  const handleQuestionSubmit = async (
    question: PracticeQuestionRecord,
    studentAnswer: unknown,
    submissionContext: Record<string, unknown> = {}
  ) => {
    if (reviewStates[question.id]?.status === "submitting") {
      return;
    }

    const mode: QuestionReviewState["mode"] = questionNeedsAIJudge(question) ? "ai" : "local";
    const answerPreview = formatAnswerPreview(studentAnswer);

    if (question.question_type === "Drawing" && mode === "ai") {
      const capabilities = reviewCapabilities ?? (await loadReviewCapabilities());
      if (capabilities && !capabilities.support_vision) {
        setReviewStates((previous) => ({
          ...previous,
          [question.id]: {
            status: "error",
            mode,
            answerPreview,
            error: "当前模型未开启视觉能力，不支持作图题评析。",
          },
        }));
        return;
      }

      const drawingImageDataUrl = submissionContext.drawing_image_data_url;
      if (typeof drawingImageDataUrl !== "string" || !drawingImageDataUrl.trim()) {
        setReviewStates((previous) => ({
          ...previous,
          [question.id]: {
            status: "error",
            mode,
            answerPreview,
            error: "未获取到绘图图像，无法提交给视觉模型进行评析。",
          },
        }));
        return;
      }
    }

    setReviewStates((previous) => ({
      ...previous,
      [question.id]: {
        status: "submitting",
        mode,
        answerPreview,
      },
    }));

    if (mode === "local") {
      const review = buildLocalReview(question, studentAnswer);
      setReviewStates((previous) => ({
        ...previous,
        [question.id]: {
          status: "completed",
          mode,
          answerPreview,
          review,
        },
      }));
      void persistReviewedEvent(
        question,
        studentAnswer,
        submissionContext,
        review,
        "practice_review_local"
      );
      return;
    }

    try {
      const response = await fetch("/api/v1/practice-review/judge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          learner_id: learnerId ?? null,
          session_id: sessionId ?? null,
          learning_goal: learningGoal,
          question: buildPracticeReviewQuestionPayload(question),
          student_answer: studentAnswer,
          submission_context: submissionContext,
        }),
      });

      if (!response.ok) {
        let message = `AI 批阅请求失败（${response.status}）`;
        try {
          const errorPayload = (await response.json()) as { detail?: string };
          if (typeof errorPayload.detail === "string" && errorPayload.detail.trim()) {
            message = errorPayload.detail;
          }
        } catch {
          // Keep the fallback message when error payload is not JSON.
        }
        throw new Error(message);
      }

      const review = (await response.json()) as PracticeReviewResponse;
      setReviewStates((previous) => ({
        ...previous,
        [question.id]: {
          status: "completed",
          mode,
          answerPreview,
          review,
        },
      }));
    } catch (error) {
      setReviewStates((previous) => ({
        ...previous,
        [question.id]: {
          status: "error",
          mode,
          answerPreview,
          error: error instanceof Error ? error.message : "AI 批阅失败，请稍后重试。",
        },
      }));
    }
  };

  const handleExportPdf = async () => {
    if (questions.length === 0 || isExportingPdf) {
      return;
    }

    setIsExportingPdf(true);
    setExportPdfError(null);

    const generatedAt = new Date();
    const fileName = `${sanitizePdfFileName(learningGoal || "practice-questions")}-${formatExportDateTime(generatedAt)}.pdf`;

    // Inject PDF styles into <head> so html2canvas can pick them up
    const styleEl = document.createElement("style");
    styleEl.setAttribute("data-pdf-export", "true");
    styleEl.textContent = PDF_PAGE_STYLE;
    document.head.appendChild(styleEl);

    // Inject KaTeX CSS so math renders correctly in html2canvas
    const katexLink = document.createElement("link");
    katexLink.rel = "stylesheet";
    katexLink.href = katexCssUrl;
    katexLink.setAttribute("data-pdf-export", "true");
    document.head.appendChild(katexLink);

    // Create a hidden container with just the sheet content (no <html>/<body> wrapper)
    const container = document.createElement("div");
    container.style.cssText =
      "position:fixed;left:-9999px;top:0;width:794px;z-index:-9999;pointer-events:none;";
    container.innerHTML = buildPracticeQuestionsPdfHtml(learningGoal, questions, generatedAt, pdfLayoutMode)
      .replace(/<!DOCTYPE[^>]*>/i, "")
      .replace(/<\/?html[^>]*>/gi, "")
      .replace(/<\/?head[^>]*>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<\/?body[^>]*>/gi, "")
      .replace(/<meta[^>]*>/gi, "");

    document.body.appendChild(container);

    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 500));

      const target = container.querySelector(".practice-pdf-sheet") ?? container;

      const html2pdf = (await import("html2pdf.js")).default;
      await html2pdf()
        .set({
          filename: fileName,
          margin: [10, 10, 10, 10],
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: {
            backgroundColor: "#ffffff",
            scale: 2,
            useCORS: true,
            logging: false,
          },
          jsPDF: {
            format: "a4",
            orientation: "portrait",
            unit: "mm",
          },
          pagebreak: {
            mode: ["css", "legacy"],
            avoid: [".practice-pdf-question"],
          },
        })
        .from(target)
        .save();
    } catch (error) {
      setExportPdfError(error instanceof Error ? error.message : "PDF 导出失败，请稍后重试。");
    } finally {
      container.remove();
      styleEl.remove();
      katexLink.remove();
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="custom-scrollbar w-full h-full flex flex-col gap-8 overflow-y-auto pr-4">
      <div className="rounded-3xl border bg-card text-card-foreground px-5 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Practice Goal</p>
            <p className="max-w-3xl text-sm leading-6 text-foreground">
              {learningGoal.trim() || "当前未提供学习目标，系统将按题目内容进行批阅。"}
            </p>
          </div>
          <div className="flex max-w-full flex-col items-start gap-3 sm:items-end">
            <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
              {summaryBadges.map(([type, count]) => (
                <Badge
                  key={type}
                  variant="outline"
                  className={`rounded-full px-3 py-1 ${QUESTION_TYPE_BADGE_CLASS[type]}`}
                >
                  {QUESTION_TYPE_LABELS[type]} x {count}
                </Badge>
              ))}
            </div>
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <div className="flex items-center gap-1 rounded-full border bg-muted/30 p-0.5">
                <button
                  type="button"
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    pdfLayoutMode === "loose"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setPdfLayoutMode("loose")}
                >
                  松散
                </button>
                <button
                  type="button"
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    pdfLayoutMode === "compact"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setPdfLayoutMode("compact")}
                >
                  紧凑
                </button>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                disabled={isLoading || !!error || questions.length === 0 || isExportingPdf}
                onClick={handleExportPdf}
              >
                {isExportingPdf ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                {isExportingPdf ? "正在导出" : "导出 PDF"}
              </Button>
              {exportPdfError ? <p className="max-w-xs text-xs text-destructive">{exportPdfError}</p> : null}
            </div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-2xl border bg-card text-card-foreground px-5 py-4 text-sm text-muted-foreground shadow-sm">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          正在加载真实题库...
        </div>
      ) : null}

      {!isLoading && error ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-5 py-4 text-sm text-destructive shadow-sm">
          {error}
        </div>
      ) : null}

      {!isLoading && !error && questions.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card text-card-foreground px-5 py-8 text-sm text-muted-foreground shadow-sm">
          {emptyHint}
        </div>
      ) : null}

      {!isLoading && !error && questions.length > 0
        ? questions.map((question, index) => (
          <section key={question.id} className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="rounded-full px-3 py-1">
                第 {index + 1} 题
              </Badge>
              <Badge variant="outline" className={QUESTION_TYPE_BADGE_CLASS[question.question_type]}>
                {QUESTION_TYPE_LABELS[question.question_type]}
              </Badge>
              {questionNeedsAIJudge(question) ? (
                <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary">
                  AI 批阅
                </Badge>
              ) : (
                <Badge variant="outline" className="border-border bg-muted/50 text-muted-foreground">
                  自动判题
                </Badge>
              )}
            </div>

            {renderQuestionCard(question, handleQuestionSubmit)}
            <QuestionReviewPanel state={reviewStates[question.id]} />
          </section>
        ))
        : null}
    </div>
  );
}
