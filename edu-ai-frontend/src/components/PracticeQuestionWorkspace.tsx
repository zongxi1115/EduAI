import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, ChevronDown, ChevronUp, ClipboardCheck, FileDown, LoaderCircle, Sparkles, Upload, CheckCircle2, XCircle, AlertTriangle, HelpCircle } from "lucide-react";
import { marked } from "marked";
import katex from "katex";
import katexCssUrl from "katex/dist/katex.min.css?url";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Markdown } from "@/components/ui/markdown";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { SingleChoiceQuestion } from "@/components/SingleChoiceQuestion";
import { ProgrammingQuestion } from "@/components/ProgrammingQuestion";
import { FillInTheBlanksQuestion } from "@/components/FillInTheBlanksQuestion";
import { ShortAnswerQuestion } from "@/components/ShortAnswerQuestion";
import { DrawingQuestion } from "@/components/DrawingQuestion";
import { KATEX_RENDER_OPTIONS } from "@/lib/math";
import { apiUrl } from "@/lib/api";

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

interface PaperQuestionReview {
  question_id: string;
  question_index: number;
  correctness: ReviewCorrectness;
  score: number;
  summary: string;
  issues: string[];
  review_advice: string[];
  reference_points: string[];
}

interface PaperPracticeReviewResponse {
  correctness: ReviewCorrectness;
  score: number;
  summary: string;
  strengths: string[];
  issues: string[];
  review_advice: string[];
  question_reviews: PaperQuestionReview[];
  limitations: string[];
  answer_image_count: number;
  judged_at?: string | null;
}

interface QuestionReviewState {
  status: "submitting" | "completed" | "error";
  mode: "ai" | "local";
  answerPreview: string;
  review?: PracticeReviewResponse;
  error?: string;
}

type QuestionSlideState =
  | { status: "idle" }
  | { status: "creating" }
  | { status: "error"; message: string };

interface QuestionClassroomResponse {
  run_id?: string;
  status?: string;
}

interface PracticeReviewCapabilitiesResponse {
  support_vision: boolean;
}

interface LearningGraphContext {
  dataset_id?: string | null;
  course_group_id?: string | null;
  course_id?: string | null;
  focus_node_id?: string | null;
  focus_node_title?: string | null;
  source_graph_id?: string | null;
}

interface PracticeQuestionWorkspaceProps {
  learningGoal: string;
  questions: PracticeQuestionRecord[];
  learnerId?: string | null;
  graphContext?: LearningGraphContext | null;
  sessionId?: string | null;
  isLoading?: boolean;
  error?: string | null;
  emptyHint?: string;
  onReviewStatesChange?: (states: Record<string, QuestionReviewState>) => void;
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
  FillInTheBlank: "border-orange-400 bg-orange-50 text-orange-700",
  MultipleChoice: "border-blue-400 bg-blue-50 text-blue-700",
  ShortAnswer: "border-green-400 bg-green-50 text-green-700",
  Listening: "border-purple-400 bg-purple-50 text-purple-700",
  Coding: "border-pink-400 bg-pink-50 text-pink-700",
  Drawing: "border-indigo-400 bg-indigo-50 text-indigo-700",
};

const PDF_TYPE_ACCENT: Record<PracticeQuestionType, string> = {
  FillInTheBlank: "#f97316",
  MultipleChoice: "#3b82f6",
  ShortAnswer: "#22c55e",
  Listening: "#a855f7",
  Coding: "#ec4899",
  Drawing: "#6366f1",
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

const PDF_SECTION_DESCRIPTIONS: Record<PracticeQuestionType, string> = {
  MultipleChoice: "单项选择，每题只有一个正确答案",
  FillInTheBlank: "根据题意填写正确内容",
  ShortAnswer: "按要点作答，条理清晰",
  Listening: "听材料后作答",
  Coding: "写出代码或核心步骤",
  Drawing: "在作图区完成图示",
};

const PDF_SECTION_NUMBERS = ["一", "二", "三", "四", "五", "六"];

const PDF_PAGE_STYLE = `
  @page {
    size: A4;
    margin: 0;
  }

  .practice-pdf-sheet, .practice-pdf-sheet * {
    box-sizing: border-box;
  }

  html,
  body {
    margin: 0;
    background: #f4f4f4;
    color: #000;
  }

  .practice-pdf-sheet {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    padding: 20mm 22mm;
    background: #ffffff;
    color: #000000;
    font-family: "Times New Roman", "SimSun", "宋体", "Songti SC", serif;
    font-size: 15px;
    line-height: 1.75;
  }

  .practice-pdf-cover {
    margin-bottom: 26px;
    border-bottom: 2px solid #000000;
    padding-bottom: 12px;
  }

  .practice-pdf-title {
    margin: 0 0 6px;
    color: #000000;
    font-size: 26px;
    font-weight: bold;
    letter-spacing: 2px;
    line-height: 1.35;
  }

  .practice-pdf-subtitle {
    margin: 0;
    color: #333333;
    font-size: 15px;
  }

  .practice-pdf-description {
    margin-top: 12px;
    color: #333333;
    font-size: 14px;
    line-height: 1.7;
  }

  .practice-pdf-section {
    margin-top: 26px;
    page-break-after: avoid;
  }

  .practice-pdf-section:first-of-type {
    margin-top: 0;
  }

  .practice-pdf-section-title {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 14px;
    color: #000000;
    font-size: 18px;
    font-weight: bold;
    page-break-after: avoid;
  }

  .practice-pdf-section-index {
    position: relative;
    display: inline-block;
    flex: 0 0 28px;
    width: 28px;
    height: 28px;
    border: 1.5px solid #000000;
    border-radius: 50%;
    font-family: "Microsoft YaHei", "SimHei", "SimSun", sans-serif;
    font-size: 16px;
    font-weight: 500;
    line-height: 28px;
    text-align: center;
  }

  .practice-pdf-section-index-text {
    position: relative;
    top: -2px;
  }

  .practice-pdf-section-desc {
    margin-left: auto;
    color: #555555;
    font-size: 14px;
    font-weight: normal;
    text-align: right;
  }

  .practice-pdf-question-list {
    counter-reset: question;
  }

  .practice-pdf-question {
    counter-increment: question;
    margin-bottom: 18px;
    padding: 14px 16px;
    border: 1px solid #d8d8d8;
    border-radius: 4px;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .practice-pdf-question-title {
    position: relative;
    margin-bottom: 8px;
    padding-left: 34px;
    color: #000000;
    font-size: 15.5px;
    line-height: 1.75;
  }

  .practice-pdf-question-title::before {
    content: counter(question) ".";
    position: absolute;
    left: 0;
    top: 0;
    width: 28px;
    text-align: right;
    font-weight: bold;
  }

  .practice-pdf-question-difficulty {
    margin-left: 8px;
    color: #666666;
    font-size: 12px;
    white-space: nowrap;
  }

  .practice-pdf-markdown {
    color: #000000;
    font-size: 15px;
    line-height: 1.75;
  }

  .practice-pdf-markdown > :first-child { margin-top: 0; }
  .practice-pdf-markdown > :last-child { margin-bottom: 0; }

  .practice-pdf-question-title > .practice-pdf-markdown,
  .practice-pdf-question-title > .practice-pdf-markdown p,
  .practice-pdf-option > .practice-pdf-markdown,
  .practice-pdf-option > .practice-pdf-markdown p {
    display: inline;
  }

  .practice-pdf-markdown p {
    margin: 0 0 6px;
  }

  .practice-pdf-markdown ul,
  .practice-pdf-markdown ol {
    margin: 4px 0 6px 20px;
    padding: 0;
  }

  .practice-pdf-markdown li { margin-bottom: 2px; }

  .practice-pdf-markdown pre {
    margin: 8px 0;
    padding: 8px 10px;
    border: 1px solid #d8d8d8;
    background: #f7f7f7;
    color: #000000;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 12px;
    line-height: 1.55;
    white-space: pre-wrap;
  }

  .practice-pdf-markdown code {
    display: inline-block;
    position: relative;
    top: -1px;
    background: #f2f2f2;
    border-radius: 2px;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 0.84em;
    line-height: 1.15;
    margin: 0 2px;
    padding: 2px 5px 1px;
    vertical-align: baseline;
  }

  .practice-pdf-markdown pre code {
    display: inline;
    position: static;
    background: none;
    margin: 0;
    padding: 0;
    font-size: inherit;
    line-height: inherit;
    vertical-align: baseline;
  }
  .practice-pdf-markdown strong { font-weight: 700; }
  .practice-pdf-markdown em { font-style: italic; }

  .practice-pdf-options {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px 28px;
    margin-top: 4px;
    padding-left: 34px;
    font-size: 15px;
  }

  .practice-pdf-option {
    min-height: 26px;
  }

  .practice-pdf-blank-inline {
    display: inline-block;
    min-width: 150px;
    height: 20px;
    border-bottom: 1px solid #000000;
    vertical-align: middle;
    margin: 0 4px;
  }

  .practice-pdf-answer {
    margin-left: 34px;
    margin-top: 10px;
  }

  .practice-pdf-answer-area {
    height: 112px;
    background-image: repeating-linear-gradient(
      to bottom,
      transparent 0,
      transparent 31px,
      #000000 32px
    );
    background-size: 100% 32px;
  }

  .practice-pdf-answer-area--listening {
    height: 160px;
  }

  .practice-pdf-answer-area--coding {
    height: 260px;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  }

  .practice-pdf-answer-area--drawing {
    height: 260px;
    border: 1px dashed #999999;
    background-image: none;
  }

  .practice-pdf-blank-list {
    margin-left: 34px;
    margin-top: 8px;
  }

  .practice-pdf-blank-line {
    display: block;
    width: 180px;
    height: 22px;
    border-bottom: 1px solid #000000;
  }

  .practice-pdf-note {
    margin: 0 0 8px 34px;
    color: #555555;
    font-size: 14px;
    line-height: 1.7;
  }

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
    body {
      background: #ffffff;
    }

    .practice-pdf-sheet {
      width: 210mm;
      min-height: 297mm;
      margin: 0;
      box-shadow: none;
    }

    .practice-pdf-question { page-break-inside: avoid; }
    .practice-pdf-section-title { page-break-after: avoid; }
  }
`;

const CORRECTNESS_META: Record<
  ReviewCorrectness,
  { label: string; badgeClassName: string; summaryClassName: string; icon: typeof CheckCircle2 }
> = {
  correct: {
    label: "回答正确",
    badgeClassName: "border-green-500 bg-green-50 text-green-700",
    summaryClassName: "text-green-700",
    icon: CheckCircle2,
  },
  partially_correct: {
    label: "部分正确",
    badgeClassName: "border-orange-500 bg-orange-50 text-orange-700",
    summaryClassName: "text-orange-700",
    icon: AlertTriangle,
  },
  incorrect: {
    label: "回答错误",
    badgeClassName: "border-red-500 bg-red-50 text-red-700",
    summaryClassName: "text-red-700",
    icon: XCircle,
  },
  ungradable: {
    label: "暂无法判定",
    badgeClassName: "border-gray-300 bg-gray-50 text-gray-700",
    summaryClassName: "text-gray-700",
    icon: HelpCircle,
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

function stripChoiceAnswerPrefix(value: string) {
  return value
    .trim()
    .replace(/^(?:正确答案|答案)\s*[:：]?\s*/u, "")
    .trim();
}

function extractChoiceLabel(value: string) {
  const text = stripChoiceAnswerPrefix(value);
  const standaloneMatch = text.match(/^[（(]?\s*(?:选项?|选择)?\s*([A-Za-z])\s*[）)]?$/u);
  if (standaloneMatch) {
    return standaloneMatch[1].toUpperCase();
  }

  const prefixedMatch = text.match(/^[（(]?\s*(?:选项?|选择)?\s*([A-Za-z])\s*[）)]?\s*[.．、:：\-\s]/u);
  return prefixedMatch ? prefixedMatch[1].toUpperCase() : null;
}

function normalizeChoiceText(value: string) {
  return stripChoiceAnswerPrefix(value)
    .replace(/^[（(]?\s*(?:选项?|选择)?\s*[A-Za-z]\s*[）)]?\s*[.．、:：\-\s]\s*/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeMultipleChoiceAnswer(options: string[], answer: string) {
  const answerLabel = extractChoiceLabel(answer);
  if (answerLabel) {
    const optionIndex = answerLabel.charCodeAt(0) - 65;
    if (optionIndex >= 0 && optionIndex < options.length) {
      return options[optionIndex];
    }
  }

  const normalizedAnswer = normalizeChoiceText(answer);
  const matchedOption = options.find((option) => normalizeChoiceText(option) === normalizedAnswer);
  return matchedOption ?? answer.trim();
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
        katex.renderToString(tex.trim(), { ...KATEX_RENDER_OPTIONS, displayMode: true })
      );
    } catch {
      mathBlocks.push(`<code>$$${escapeHtml(tex.trim())}$$</code>`);
    }
    return `%%MATH_BLOCK_${idx}%%`;
  });

  // $ ... $ (inline math)
  processed = processed.replace(/\$([^$\n]+?)\$/g, (_match, tex: string) => {
    const idx = mathBlocks.length;
    try {
      mathBlocks.push(
        katex.renderToString(tex.trim(), { ...KATEX_RENDER_OPTIONS, displayMode: false })
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

function formatPracticePdfTitle(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return "练习题";
  }
  return /(?:练习题|习题|题库|试卷)$/u.test(normalized) ? normalized : `${normalized}练习题`;
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

function readImageFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("图片读取失败，请重新选择文件。"));
      }
    };
    reader.onerror = () => reject(new Error("图片读取失败，请重新选择文件。"));
    reader.readAsDataURL(file);
  });
}

function renderPdfOptions(question: PracticeQuestionRecord) {
  if (question.question_type !== "MultipleChoice") {
    return "";
  }

  return `
    <div class="practice-pdf-options">
      ${question.options
        .map((option, index) => {
          const label = String.fromCharCode(65 + index);
          return `
            <div class="practice-pdf-option">
              ${label}.
              <div class="practice-pdf-markdown">${renderPdfMarkdown(option)}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderPdfFillInBlankBody(question: PracticeQuestionRecord, mode: "compact" | "loose") {
  if (
    question.question_type !== "FillInTheBlank" ||
    mode === "compact" ||
    /_{2,}/.test(question.question)
  ) {
    return "";
  }
  return `
    <div class="practice-pdf-blank-list"><span class="practice-pdf-blank-line"></span></div>
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
    return "";
  }

  const areaClass =
    question.question_type === "Listening"
      ? "practice-pdf-answer-area--listening"
      : question.question_type === "Coding"
        ? "practice-pdf-answer-area--coding"
        : question.question_type === "Drawing"
          ? "practice-pdf-answer-area--drawing"
          : "";

  return `
    <div class="practice-pdf-answer">
      <div class="practice-pdf-answer-area ${areaClass}"></div>
    </div>
  `;
}

function renderPdfQuestion(question: PracticeQuestionRecord, mode: "compact" | "loose") {
  const difficultyLabel = formatDifficultyLabel(question.difficulty);
  const isFillBlank = question.question_type === "FillInTheBlank";

  return `
    <div class="practice-pdf-question">
      <div class="practice-pdf-question-title">
        <div class="practice-pdf-markdown">${renderPdfMarkdown(question.question)}</div>
        ${difficultyLabel ? `<span class="practice-pdf-question-difficulty">${escapeHtml(difficultyLabel)}</span>` : ""}
      </div>
      <div class="practice-pdf-question-body">
        ${question.question_type === "Listening" ? '<p class="practice-pdf-note">听力题请配合课堂或设备播放音频完成。</p>' : ""}
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
  const printableTitle = formatPracticePdfTitle(printableLearningGoal);

  const grouped = new Map<PracticeQuestionType, PracticeQuestionRecord[]>();
  for (const q of questions) {
    const list = grouped.get(q.question_type) ?? [];
    list.push(q);
    grouped.set(q.question_type, list);
  }

  const sections = PDF_SECTION_ORDER
    .filter((type) => grouped.has(type))
    .map((type, sectionIdx) => {
      const typeQuestions = grouped.get(type)!;
      const items = typeQuestions
        .map((q) => renderPdfQuestion(q, mode))
        .join("");
      return `
        <section class="practice-pdf-section">
          <div class="practice-pdf-section-title">
            <span class="practice-pdf-section-index"><span class="practice-pdf-section-index-text">${PDF_SECTION_NUMBERS[sectionIdx]}</span></span>
            ${PDF_SECTION_LABELS[type]}
            <span class="practice-pdf-section-desc">${PDF_SECTION_DESCRIPTIONS[type]}</span>
          </div>
          <div class="practice-pdf-question-list">${items}</div>
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
      <h1 class="practice-pdf-title">${escapeHtml(printableTitle)}</h1>
      <p class="practice-pdf-subtitle">共 ${questions.length} 题&nbsp;&nbsp;导出日期 ${generatedAt.toLocaleDateString("zh-CN")}</p>
      <div class="practice-pdf-description">
        本练习围绕「${escapeHtml(printableLearningGoal)}」整理。请先独立完成，再对照知识点进行订正。
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
  if (question.question_type === "FillInTheBlank") {
    return true;
  }
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
        correct_answer: normalizeMultipleChoiceAnswer(question.options, question.correct_answer),
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
      const normalizedSubmitted = normalizeMultipleChoiceAnswer(question.options, submitted);
      const normalizedCorrectAnswer = normalizeMultipleChoiceAnswer(
        question.options,
        question.correct_answer
      );
      const isCorrect = normalizeText(normalizedSubmitted) === normalizeText(normalizedCorrectAnswer);

      return {
        correctness: isCorrect ? "correct" : "incorrect",
        score: isCorrect ? 100 : 0,
        summary: isCorrect ? "单选题回答正确。" : "当前选择与标准答案不一致。",
        strengths: isCorrect ? ["你选中了正确选项。"] : [],
        issues: isCorrect ? [] : ["建议重新比对题干关键词与各选项差异。"],
        review_advice: isCorrect
          ? ["如果想更扎实，可以再解释一下为什么其他选项不对。"]
          : ["先定位题干中的关键限定词。", "再逐项排除与题意不符的干扰项。"],
        reference_points: [`参考答案：${normalizedCorrectAnswer}`],
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
        correct_answer: normalizeMultipleChoiceAnswer(item.options, item.correct_answer),
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
      <Card className="border-blue-200 bg-blue-50/50">
        <CardContent className="flex items-start gap-3 p-4">
          <div className="rounded-full bg-blue-100 p-2">
            <LoaderCircle className="h-5 w-5 animate-spin text-blue-600" />
          </div>
          <div className="flex-1 space-y-1 text-sm">
            <p className="font-medium text-gray-900">
              {state.mode === "ai" ? "AI 正在批阅..." : "正在自动判题..."}
            </p>
            {state.answerPreview ? (
              <p className="text-gray-600">你的答案：{state.answerPreview}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (state.status === "error") {
    return (
      <Card className="border-red-200 bg-red-50/50">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-red-100 p-2">
                <AlertCircle className="h-5 w-5 text-red-600" />
              </div>
              <div className="flex-1 space-y-1 text-sm">
                <p className="font-medium text-red-900">批阅失败</p>
                {!isCollapsed ? (
                  <p className="text-red-700">{state.error || "提交后暂时无法返回结果，请稍后重试。"}</p>
                ) : null}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-2 text-xs text-red-700 hover:bg-red-100"
              onClick={() => setIsCollapsed((previous) => !previous)}
            >
              {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
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
  const StatusIcon = meta.icon;

  return (
    <Card className="border shadow-sm bg-white">
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={`px-2.5 py-0.5 text-xs font-medium ${meta.badgeClassName}`}>
              <StatusIcon className="mr-1 h-3.5 w-3.5" />
              {meta.label}
            </Badge>
            <Badge variant="outline" className="border-blue-400 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
              {state.review.score} 分
            </Badge>
            <span className="text-xs text-gray-500">
              {state.mode === "ai" ? "AI批阅" : "自动判题"}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs text-gray-600 hover:bg-gray-100"
            onClick={() => setIsCollapsed((previous) => !previous)}
          >
            {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            <span className="ml-1">{isCollapsed ? "展开" : "收起"}</span>
          </Button>
        </div>

        <div className="space-y-1.5">
          <p className={`text-sm font-medium ${meta.summaryClassName}`}>{state.review.summary}</p>
          {state.answerPreview ? <p className="text-sm text-gray-600">你的答案：{state.answerPreview}</p> : null}
        </div>

        {!isCollapsed && state.review.review_advice.length > 0 ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50/50 px-3.5 py-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-blue-900">
              <Sparkles className="h-4 w-4" />
              审阅建议
            </div>
            <ul className="space-y-1.5 text-sm leading-relaxed text-gray-700">
              {state.review.review_advice.map((item, index) => (
                <li key={`${item}-${index}`} className="flex gap-2">
                  <span className="text-blue-600">•</span>
                  <span className="flex-1">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!isCollapsed && state.review.strengths.length > 0 ? (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              做得好的地方
            </p>
            <ul className="space-y-1 rounded-lg border border-green-200 bg-green-50/50 px-3.5 py-2.5 text-sm leading-relaxed text-gray-700">
              {state.review.strengths.map((item, index) => (
                <li key={`${item}-${index}`} className="flex gap-2">
                  <span className="text-green-600">•</span>
                  <span className="flex-1">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!isCollapsed && state.review.issues.length > 0 ? (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
              <AlertTriangle className="h-4 w-4 text-orange-600" />
              需要改进
            </p>
            <ul className="space-y-1 rounded-lg border border-orange-200 bg-orange-50/50 px-3.5 py-2.5 text-sm leading-relaxed text-gray-700">
              {state.review.issues.map((item, index) => (
                <li key={`${item}-${index}`} className="flex gap-2">
                  <span className="text-orange-600">•</span>
                  <span className="flex-1">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!isCollapsed && state.review.reference_points.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-900">参考答案</p>
            <ul className="space-y-1 rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm leading-relaxed text-gray-700">
              {state.review.reference_points.map((item, index) => (
                <li key={`${item}-${index}`} className="flex gap-2">
                  <span className="text-gray-500">•</span>
                  <span className="flex-1">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PaperPracticeReviewPanel({
  review,
  isLoading,
  error,
}: {
  review: PaperPracticeReviewResponse | null;
  isLoading: boolean;
  error: string | null;
}) {
  if (isLoading) {
    return (
      <Card className="border-blue-200 bg-blue-50/50">
        <CardContent className="flex items-start gap-3 p-4">
          <div className="rounded-full bg-blue-100 p-2">
            <LoaderCircle className="h-5 w-5 animate-spin text-blue-600" />
          </div>
          <div className="space-y-1 text-sm">
            <p className="font-medium text-blue-950">正在批阅纸笔答案...</p>
            <p className="text-blue-700">大模型会读取上传图片，并按当前题目逐项给出反馈。</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50/50">
        <CardContent className="flex items-start gap-3 p-4">
          <div className="rounded-full bg-red-100 p-2">
            <AlertCircle className="h-5 w-5 text-red-600" />
          </div>
          <div className="space-y-1 text-sm">
            <p className="font-medium text-red-900">纸笔答案批阅失败</p>
            <p className="text-red-700">{error}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!review) {
    return null;
  }

  const meta = CORRECTNESS_META[review.correctness];
  const StatusIcon = meta.icon;

  return (
    <Card className="border shadow-sm bg-white">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={`px-2.5 py-0.5 text-xs font-medium ${meta.badgeClassName}`}>
              <StatusIcon className="mr-1 h-3.5 w-3.5" />
              {meta.label}
            </Badge>
            <Badge variant="outline" className="border-blue-400 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
              {review.score} 分
            </Badge>
            <span className="text-xs text-gray-500">纸笔批阅 · {review.answer_image_count} 张图片</span>
          </div>
          {review.judged_at ? (
            <span className="text-xs text-gray-400">{new Date(review.judged_at).toLocaleString()}</span>
          ) : null}
        </div>

        <p className={`text-sm font-medium ${meta.summaryClassName}`}>{review.summary}</p>

        {(review.strengths.length > 0 || review.issues.length > 0) ? (
          <div className="grid gap-3 md:grid-cols-2">
            {review.strengths.length > 0 ? (
              <div className="rounded-lg border border-green-200 bg-green-50/50 px-3.5 py-3">
                <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-green-900">
                  <CheckCircle2 className="h-4 w-4" />
                  做得好的地方
                </p>
                <ul className="space-y-1.5 text-sm leading-relaxed text-gray-700">
                  {review.strengths.map((item, index) => (
                    <li key={`${item}-${index}`} className="flex gap-2">
                      <span className="text-green-600">•</span>
                      <span className="flex-1">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {review.issues.length > 0 ? (
              <div className="rounded-lg border border-orange-200 bg-orange-50/50 px-3.5 py-3">
                <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-orange-900">
                  <AlertTriangle className="h-4 w-4" />
                  主要问题
                </p>
                <ul className="space-y-1.5 text-sm leading-relaxed text-gray-700">
                  {review.issues.map((item, index) => (
                    <li key={`${item}-${index}`} className="flex gap-2">
                      <span className="text-orange-600">•</span>
                      <span className="flex-1">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {review.review_advice.length > 0 ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50/50 px-3.5 py-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-blue-900">
              <Sparkles className="h-4 w-4" />
              整卷建议
            </div>
            <ul className="space-y-1.5 text-sm leading-relaxed text-gray-700">
              {review.review_advice.map((item, index) => (
                <li key={`${item}-${index}`} className="flex gap-2">
                  <span className="text-blue-600">•</span>
                  <span className="flex-1">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {review.question_reviews.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-900">逐题反馈</p>
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {review.question_reviews.map((item) => {
                const itemMeta = CORRECTNESS_META[item.correctness];
                const ItemIcon = itemMeta.icon;
                return (
                  <div key={`${item.question_id}-${item.question_index}`} className="rounded-lg border border-gray-200 bg-gray-50/70 p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">第 {item.question_index} 题</span>
                      <Badge variant="outline" className={`px-2 py-0 text-xs font-medium ${itemMeta.badgeClassName}`}>
                        <ItemIcon className="mr-1 h-3 w-3" />
                        {itemMeta.label}
                      </Badge>
                      <span className="text-xs text-gray-500">{item.score} 分</span>
                    </div>
                    <p className="text-sm leading-relaxed text-gray-700">{item.summary}</p>
                    {item.issues.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-sm leading-relaxed text-orange-700">
                        {item.issues.map((issue, index) => (
                          <li key={`${issue}-${index}`} className="flex gap-2">
                            <span>•</span>
                            <span className="flex-1">{issue}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {item.review_advice.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-sm leading-relaxed text-blue-700">
                        {item.review_advice.map((advice, index) => (
                          <li key={`${advice}-${index}`} className="flex gap-2">
                            <span>•</span>
                            <span className="flex-1">{advice}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {review.limitations.length > 0 ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm leading-relaxed text-gray-600">
            {review.limitations.join(" ")}
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
  graphContext,
  sessionId,
  isLoading = false,
  error,
  emptyHint = "当前还没有可展示的练习题，请等待题库生成完成。",
  onReviewStatesChange,
}: PracticeQuestionWorkspaceProps) {
  const navigate = useNavigate();
  const [reviewStates, setReviewStates] = useState<Record<string, QuestionReviewState>>({});
  const [questionSlideStates, setQuestionSlideStates] = useState<Record<string, QuestionSlideState>>({});
  const [reviewCapabilities, setReviewCapabilities] =
    useState<PracticeReviewCapabilitiesResponse | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [exportPdfError, setExportPdfError] = useState<string | null>(null);
  const [isPaperMenuOpen, setIsPaperMenuOpen] = useState(false);
  const [isReviewingPaper, setIsReviewingPaper] = useState(false);
  const [paperReviewError, setPaperReviewError] = useState<string | null>(null);
  const [paperReview, setPaperReview] = useState<PaperPracticeReviewResponse | null>(null);
  const paperAnswerInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (onReviewStatesChange) {
      onReviewStatesChange(reviewStates);
    }
  }, [reviewStates, onReviewStatesChange]);

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
      const response = await fetch(apiUrl("/api/v1/practice-review/capabilities"), {
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

  const handleOpenQuestionSlide = async (question: PracticeQuestionRecord) => {
    const prepRunId = sessionId?.trim();
    if (!prepRunId) {
      setQuestionSlideStates((previous) => ({
        ...previous,
        [question.id]: {
          status: "error",
          message: "当前题目没有关联课前任务，暂时不能生成幻灯讲解。",
        },
      }));
      return;
    }

    if (questionSlideStates[question.id]?.status === "creating") {
      return;
    }

    setQuestionSlideStates((previous) => ({
      ...previous,
      [question.id]: { status: "creating" },
    }));

    try {
      const response = await fetch(
        `/api/v1/prep-runs/${encodeURIComponent(prepRunId)}/practice-questions/${encodeURIComponent(question.id)}/classroom`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        let message = `幻灯讲解创建失败（${response.status}）`;
        try {
          const payload = (await response.json()) as { detail?: unknown };
          if (typeof payload.detail === "string" && payload.detail.trim()) {
            message = payload.detail;
          }
        } catch {
          // Keep the fallback message when the response is not JSON.
        }
        throw new Error(message);
      }

      const payload = (await response.json()) as QuestionClassroomResponse;
      if (!payload.run_id) {
        throw new Error("后端未返回课堂任务 ID，暂时无法打开幻灯讲解。");
      }

      navigate(`/lesson/${encodeURIComponent(payload.run_id)}`, {
        state: {
          classroomLaunchMode: payload.status === "succeeded" ? "existing" : "new",
        },
      });
    } catch (error) {
      setQuestionSlideStates((previous) => ({
        ...previous,
        [question.id]: {
          status: "error",
          message: error instanceof Error ? error.message : "幻灯讲解创建失败，请稍后重试。",
        },
      }));
    }
  };

  const getQuestionSlideError = (questionId: string) => {
    const slideState = questionSlideStates[questionId];
    return slideState?.status === "error" ? slideState.message : null;
  };

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
      await fetch(apiUrl("/api/v1/learner-models/ingest-review"), {
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
          graph_context: graphContext ?? null,
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
      const response = await fetch(apiUrl("/api/v1/practice-review/judge"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          learner_id: learnerId ?? null,
          session_id: sessionId ?? null,
          learning_goal: learningGoal,
          graph_context: graphContext ?? null,
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
    container.innerHTML = buildPracticeQuestionsPdfHtml(learningGoal, questions, generatedAt, "loose")
      .replace(/<!DOCTYPE[^>]*>/i, "")
      .replace(/<\/?html[^>]*>/gi, "")
      .replace(/<\/?head[^>]*>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<\/?body[^>]*>/gi, "")
      .replace(/<meta[^>]*>/gi, "");

    document.body.appendChild(container);

    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 500));

      const target = container.querySelector<HTMLElement>(".practice-pdf-sheet") ?? container;

      const html2pdf = (await import("html2pdf.js")).default;
      await html2pdf()
        .set({
          filename: fileName,
          margin: [0, 0, 0, 0],
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

  const handlePaperAnswerImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    if (isReviewingPaper || questions.length === 0) {
      event.target.value = "";
      return;
    }

    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) {
      return;
    }

    const nonImageFile = files.find((file) => !file.type.startsWith("image/"));
    if (nonImageFile) {
      setPaperReviewError(`"${nonImageFile.name}" 不是图片文件，请上传答案图片。`);
      setPaperReview(null);
      return;
    }

    const capabilities = reviewCapabilities ?? (await loadReviewCapabilities());
    if (capabilities && !capabilities.support_vision) {
      setPaperReviewError("当前模型未开启视觉能力，不支持纸笔答案图片批阅。");
      setPaperReview(null);
      return;
    }

    setIsPaperMenuOpen(false);
    setIsReviewingPaper(true);
    setPaperReviewError(null);
    setPaperReview(null);

    try {
      const answerImages = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          data_url: await readImageFileAsDataUrl(file),
        }))
      );

      const response = await fetch("/api/v1/practice-review/paper/judge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          learner_id: learnerId ?? null,
          session_id: sessionId ?? null,
          learning_goal: learningGoal,
          graph_context: graphContext ?? null,
          questions: questions.map((question) => buildPracticeReviewQuestionPayload(question)),
          answer_images: answerImages,
        }),
      });

      if (!response.ok) {
        let message = `纸笔答案批阅请求失败（${response.status}）`;
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

      const review = (await response.json()) as PaperPracticeReviewResponse;
      setPaperReview(review);
    } catch (error) {
      setPaperReviewError(error instanceof Error ? error.message : "纸笔答案批阅失败，请稍后重试。");
    } finally {
      setIsReviewingPaper(false);
    }
  };

  return (
    <div className="custom-scrollbar w-full h-full flex flex-col gap-6 overflow-y-auto pr-4">
      <div className="rounded-lg border bg-white px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">学习目标</p>
            <p className="max-w-3xl text-base font-medium leading-relaxed text-gray-900">
              {learningGoal.trim() || "当前未提供学习目标，系统将按题目内容进行批阅。"}
            </p>
          </div>
          <div className="flex max-w-full flex-col items-start gap-3 sm:items-end">
            <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
              {summaryBadges.map(([type, count]) => (
                <Badge
                  key={type}
                  variant="outline"
                  className={`px-2.5 py-0.5 text-xs font-medium ${QUESTION_TYPE_BADGE_CLASS[type]}`}
                >
                  {QUESTION_TYPE_LABELS[type]} × {count}
                </Badge>
              ))}
            </div>
            <div className="flex flex-col items-start gap-2.5 sm:items-end">
              <input
                ref={paperAnswerInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handlePaperAnswerImageChange}
              />
              <Popover open={isPaperMenuOpen} onOpenChange={setIsPaperMenuOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-blue-200 bg-white text-blue-600 hover:bg-blue-50"
                    disabled={isLoading || !!error || questions.length === 0 || isExportingPdf || isReviewingPaper}
                  >
                    {isExportingPdf || isReviewingPaper ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <ClipboardCheck className="h-4 w-4" />
                    )}
                    纸笔答题
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 p-2">
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isExportingPdf}
                    onClick={() => {
                      setIsPaperMenuOpen(false);
                      void handleExportPdf();
                    }}
                  >
                    {isExportingPdf ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                    <span>{isExportingPdf ? "正在导出 PDF" : "下载 PDF"}</span>
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isReviewingPaper}
                    onClick={() => paperAnswerInputRef.current?.click()}
                  >
                    {isReviewingPaper ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    <span>{isReviewingPaper ? "正在批阅答案" : "上传答案图片"}</span>
                  </button>
                </PopoverContent>
              </Popover>
              {exportPdfError ? <p className="max-w-xs text-xs text-red-600">{exportPdfError}</p> : null}
            </div>
          </div>
        </div>
      </div>

      <PaperPracticeReviewPanel
        review={paperReview}
        isLoading={isReviewingPaper}
        error={paperReviewError}
      />

      {isLoading ? (
        <div className="flex items-center gap-3 rounded-lg border bg-white px-4 py-3 text-sm text-gray-600">
          <div className="rounded-full bg-blue-100 p-2">
            <LoaderCircle className="h-4 w-4 animate-spin text-blue-600" />
          </div>
          正在加载题目...
        </div>
      ) : null}

      {!isLoading && error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {!isLoading && !error && questions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-500">
          {emptyHint}
        </div>
      ) : null}

      {!isLoading && !error && questions.length > 0
        ? questions.map((question, index) => {
          const questionSlideError = getQuestionSlideError(question.id);
          const isCreatingQuestionSlide = questionSlideStates[question.id]?.status === "creating";

          return (
          <section key={question.id} id={`question-${question.id}`} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full font-semibold text-white shadow-sm"
                  style={{ backgroundColor: PDF_TYPE_ACCENT[question.question_type] }}
                >
                  {index + 1}
                </div>
                <Badge
                  variant="outline"
                  className={`px-2.5 py-0.5 text-xs font-medium ${QUESTION_TYPE_BADGE_CLASS[question.question_type]}`}
                >
                  {QUESTION_TYPE_LABELS[question.question_type]}
                </Badge>
                {questionNeedsAIJudge(question) ? (
                  <Badge variant="outline" className="border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600">
                    <Sparkles className="mr-1 h-3 w-3" />
                    AI批阅
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-gray-300 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                    自动判题
                  </Badge>
                )}
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-indigo-200 bg-white text-indigo-600 hover:bg-indigo-50"
                disabled={isCreatingQuestionSlide}
                onClick={() => void handleOpenQuestionSlide(question)}
              >
                {isCreatingQuestionSlide ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {isCreatingQuestionSlide ? "正在生成" : "幻灯讲解"}
              </Button>
            </div>

            {questionSlideError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                {questionSlideError}
              </div>
            ) : null}

            {renderQuestionCard(question, handleQuestionSubmit)}
            <QuestionReviewPanel state={reviewStates[question.id]} />
          </section>
          );
        })
        : null}
    </div>
  );
}
