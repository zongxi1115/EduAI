import { useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseQuestion(item: unknown): PracticeQuestionRecord | null {
  if (!isRecord(item)) {
    return null;
  }

  const id = typeof item.id === "string" ? item.id : "";
  const question = typeof item.question === "string" ? item.question : "";
  const analysis = typeof item.analysis === "string" ? item.analysis : "";
  const questionType = item.question_type;
  const requiresAIJudgment =
    typeof item.requires_ai_judgment === "boolean" ? item.requires_ai_judgment : undefined;

  if (!id || !question || !analysis || typeof questionType !== "string") {
    return null;
  }

  const commonFields = {
    id,
    question,
    analysis,
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

function ListeningQuestionCard({ question }: { question: ListeningPracticeQuestion }) {
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
          <Button onClick={() => window.alert(`已提交答案：\n${answer || "（空）"}`)}>提交答案</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function renderQuestionCard(question: PracticeQuestionRecord) {
  switch (question.question_type) {
    case "FillInTheBlank":
      return <FillInTheBlanksQuestion questionContent={question.question} />;
    case "MultipleChoice":
      return (
        <SingleChoiceQuestion
          questionContent={question.question}
          options={question.options.map((content, index) => ({
            id: String.fromCharCode(65 + index),
            content,
          }))}
        />
      );
    case "ShortAnswer":
      return <ShortAnswerQuestion questionContent={question.question} />;
    case "Listening":
      return <ListeningQuestionCard question={question} />;
    case "Coding": {
      const language = guessProgrammingLanguage(question.reference_code);
      return (
        <ProgrammingQuestion
          questionContent={question.question}
          language={language}
          initialCode={buildStarterCode(question.reference_code, language)}
          initialRunnerCode={buildRunnerCode(question, language)}
        />
      );
    }
    case "Drawing": {
      const referenceHint = question.reference_image.trim()
        ? `\n\n参考图示提示：${question.reference_image}`
        : "";
      return <DrawingQuestion questionContent={`${question.question}${referenceHint}`} />;
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

  return (
    <div className="w-full h-full flex flex-col gap-8 overflow-y-auto pr-4">
      <Card className="border-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 text-white shadow-lg">
        <CardContent className="p-6 space-y-4">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-300">Practice Workspace</p>
            <h2 className="text-2xl font-semibold tracking-tight">{learningGoal || "练习题学习区"}</h2>
            <p className="text-sm text-slate-300">
              这里展示的是本次任务真实生成的题库内容，题型和题量会随主题、学习者画像与目标能力动态变化。
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge className="border-white/15 bg-white/10 text-white hover:bg-white/15">
              共 {questions.length} 题
            </Badge>
            {(Object.keys(typeCounts) as PracticeQuestionType[])
              .filter((questionType) => typeCounts[questionType] > 0)
              .map((questionType) => (
                <Badge
                  key={questionType}
                  variant="outline"
                  className={`border-none ${QUESTION_TYPE_BADGE_CLASS[questionType]}`}
                >
                  {QUESTION_TYPE_LABELS[questionType]} {typeCounts[questionType]} 题
                </Badge>
              ))}
          </div>
        </CardContent>
      </Card>

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
                <span className="text-xs font-medium tracking-wide text-slate-500">{question.id}</span>
              </div>

              {renderQuestionCard(question)}
            </section>
          ))
        : null}
    </div>
  );
}
