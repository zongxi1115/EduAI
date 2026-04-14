from abc import ABC, abstractmethod
from typing import Any, List, Optional
from dataclasses import dataclass

@dataclass
class BaseQuestion(ABC):
    """基础题目类"""
    id: str
    question: str
    analysis: str
    requires_ai_judgment: bool = False
    
    @abstractmethod
    def validate_answer(self, answer: Any) -> bool:
        """验证答案"""
        pass


@dataclass
class FillInTheBlank(BaseQuestion):
    """填空题"""
    answer: str
    
    def validate_answer(self, answer: str) -> bool:
        return answer.strip() == self.answer.strip()


@dataclass
class MultipleChoice(BaseQuestion):
    """单选题"""
    options: List[str]
    correct_answer: str
    
    def validate_answer(self, answer: str) -> bool:
        return answer == self.correct_answer


@dataclass
class ShortAnswer(BaseQuestion):
    """简答题"""
    reference_answer: str
    requires_ai_judgment: bool = True
    
    def validate_answer(self, answer: str) -> bool:
        # 简答题需要AI判断
        return self.requires_ai_judgment


@dataclass
class Listening(BaseQuestion):
    """听力题"""
    audio_src: str
    answer: str
    
    def validate_answer(self, answer: str) -> bool:
        return answer.strip() == self.answer.strip()


@dataclass
class Coding(BaseQuestion):
    """编程题"""
    reference_code: str
    test_cases: List[tuple]
    requires_ai_judgment: bool = True
    
    def validate_answer(self, code: str) -> bool:
        # 编程题需要AI判断和测试
        return self.requires_ai_judgment


@dataclass
class Drawing(BaseQuestion):
    """作图题"""
    reference_image: str
    requires_ai_judgment: bool = True
    
    def validate_answer(self, answer: Any) -> bool:
        # 作图题需要AI判断
        return self.requires_ai_judgment