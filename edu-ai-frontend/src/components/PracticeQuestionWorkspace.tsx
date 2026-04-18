import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronDown, ChevronUp, LoaderCircle, Sparkles } from "lucide-react";
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
    badgeClassName: "border-slate-200 bg-slate-50 text-slate-700",
    summaryClassName: "text-slate-700",
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
            <div className="rounded-xl border border-dashed bg-slate-50 px-4 py-3 text-sm text-slate-500">
              当前题目没有可直接播放的音频地址。
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">作答区</p>
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
            <p className="font-medium text-slate-900">
              {state.mode === "ai" ? "AI 正在批阅这道题..." : "正在进行自动判题..."}
            </p>
            {state.answerPreview ? (
              <p className="text-slate-600">已提交：{state.answerPreview}</p>
            ) : (
              <p className="text-slate-500">已收到本次提交，正在生成反馈。</p>
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
            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
              {state.review.score} 分
            </Badge>
            {state.review.judged_at ? (
              <span className="text-xs text-slate-400">{new Date(state.review.judged_at).toLocaleString()}</span>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-full px-3 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            onClick={() => setIsCollapsed((previous) => !previous)}
          >
            {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            <span className="ml-1">{isCollapsed ? "展开" : "收起"}</span>
          </Button>
        </div>

        <div className="space-y-1">
          <p className={`text-sm font-semibold ${meta.summaryClassName}`}>{state.review.summary}</p>
          {state.answerPreview ? <p className="text-sm text-slate-500">你的提交：{state.answerPreview}</p> : null}
        </div>

        {!isCollapsed && state.review.review_advice.length > 0 ? (
          <div className="rounded-2xl border border-primary/10 bg-primary/5 px-4 py-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
              <Sparkles className="h-4 w-4" />
              审阅建议
            </div>
            <ul className="space-y-1 text-sm text-slate-700">
              {state.review.review_advice.map((item, index) => (
                <li key={`${item}-${index}`}>- {item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {!isCollapsed && state.review.strengths.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-800">做得好的地方</p>
            <ul className="space-y-1 text-sm text-slate-600">
              {state.review.strengths.map((item, index) => (
                <li key={`${item}-${index}`}>- {item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {!isCollapsed && state.review.issues.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-800">还需要关注</p>
            <ul className="space-y-1 text-sm text-slate-600">
              {state.review.issues.map((item, index) => (
                <li key={`${item}-${index}`}>- {item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {!isCollapsed && state.review.reference_points.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-800">参考要点</p>
            <ul className="space-y-1 text-sm text-slate-600">
              {state.review.reference_points.map((item, index) => (
                <li key={`${item}-${index}`}>- {item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {!isCollapsed && state.review.limitations.length > 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="mb-2 text-sm font-medium text-slate-700">判定说明</p>
            <ul className="space-y-1 text-sm text-slate-500">
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
  isLoading = false,
  error,
  emptyHint = "当前还没有可展示的练习题，请等待题库生成完成。",
}: PracticeQuestionWorkspaceProps) {
  const [reviewStates, setReviewStates] = useState<Record<string, QuestionReviewState>>({});
  const [reviewCapabilities, setReviewCapabilities] =
    useState<PracticeReviewCapabilitiesResponse | null>(null);

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

  return (
    <div className="w-full h-full flex flex-col gap-8 overflow-y-auto pr-4">
      <div className="rounded-3xl border bg-white px-5 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Practice Goal</p>
            <p className="max-w-3xl text-sm leading-6 text-slate-700">
              {learningGoal.trim() || "当前未提供学习目标，系统将按题目内容进行批阅。"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
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
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-2xl border bg-white px-5 py-4 text-sm text-slate-500 shadow-sm">
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
        <div className="rounded-2xl border border-dashed bg-white px-5 py-8 text-sm text-slate-500 shadow-sm">
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
                  <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
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
