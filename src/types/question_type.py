from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass(kw_only=True)
class BaseQuestion(ABC):
    """基础题目类。"""

    id: str
    question: str
    analysis: str
    need_ai_judge: bool = False
    skill_tags: list[str] = field(default_factory=list)
    difficulty: float | None = None

    @abstractmethod
    def validate_answer(self, answer: Any) -> bool:
        """验证答案。"""


@dataclass(kw_only=True)
class FillInTheBlank(BaseQuestion):
    """填空题。"""

    answer: str

    def validate_answer(self, answer: str) -> bool:
        return answer.strip() == self.answer.strip()


@dataclass(kw_only=True)
class MultipleChoice(BaseQuestion):
    """单选题。"""

    options: list[str]
    correct_answer: str

    def validate_answer(self, answer: str) -> bool:
        return answer == self.correct_answer


@dataclass(kw_only=True)
class ShortAnswer(BaseQuestion):
    """简答题。"""

    reference_answer: str
    need_ai_judge: bool = True

    def validate_answer(self, answer: str) -> bool:
        return self.need_ai_judge


@dataclass(kw_only=True)
class Listening(BaseQuestion):
    """听力题。"""

    audio_src: str
    answer: str

    def validate_answer(self, answer: str) -> bool:
        return answer.strip() == self.answer.strip()


@dataclass(kw_only=True)
class Coding(BaseQuestion):
    """编程题。"""

    reference_code: str
    test_cases: list[tuple]
    need_ai_judge: bool = True

    def validate_answer(self, code: str) -> bool:
        return self.need_ai_judge


@dataclass(kw_only=True)
class Drawing(BaseQuestion):
    """作图题。"""

    reference_image: str
    need_ai_judge: bool = True

    def validate_answer(self, answer: Any) -> bool:
        return self.need_ai_judge
