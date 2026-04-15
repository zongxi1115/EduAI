import { useState } from "react";
import { BookOpen, Target, FileText, LayoutDashboard, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SingleChoiceQuestion } from "@/components/SingleChoiceQuestion";
import { ProgrammingQuestion } from "@/components/ProgrammingQuestion";
import { FillInTheBlanksQuestion } from "@/components/FillInTheBlanksQuestion";

export default function StudyArea() {
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [drawerWidth, setDrawerWidth] = useState(320);
  const [isDragging, setIsDragging] = useState(false);

  const togglePanel = (panel: string) => {
    setActivePanel(current => current === panel ? null : panel);
  };

  // 拖拽改变抽屉宽度
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const startX = e.clientX;
    const startWidth = drawerWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = startX - moveEvent.clientX; // 向左移增大，向右移减小
      const newWidth = Math.max(200, Math.min(startWidth + deltaX, 800));
      setDrawerWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen bg-background">
        {/* Banner */}
        <header className="h-14 border-b bg-card flex items-center px-6 shrink-0 shadow-sm">
          <div className="flex items-center gap-2 font-semibold text-lg">
            <BookOpen className="w-5 h-5 text-primary" />
            <span>Edu AI Workspace</span>
          </div>
        </header>

        {/* Workspace */}
        <main className="flex flex-1 overflow-hidden relative">
          {/* Main Content Area */}
          <div className="flex-1 flex flex-col min-w-0 bg-background">
            {/* Custom Navigation Menu Header */}
            <div className="flex items-center px-4 h-11 border-b shrink-0 bg-muted/10 gap-4">
              <button className="flex items-center gap-2 h-full px-2 border-b-2 border-primary text-primary font-medium text-sm transition-colors">
                <LayoutDashboard className="w-4 h-4" />
                学习区
              </button>
            </div>
            
            {/* Content Area */}
            <div className="flex-1 overflow-hidden flex flex-col pt-4 px-6 md:pt-6 md:px-8 pb-8">
               <div className="w-full h-full flex flex-col gap-10 overflow-y-auto pr-4">
                  {/* 单选题测试 */}
                  <div>
                    <h2 className="text-xl font-bold mb-4 shrink-0 text-slate-800">一、单选题测试</h2>
                    <SingleChoiceQuestion
                       questionContent={String.raw`已知复数 $z = \frac{1+i}{1-i}$，则 $|z|$ 的值为：`}
                       options={[
                          { id: "A", content: String.raw`$\frac{1}{2}$` },
                          { id: "B", content: String.raw`$1$` },
                          { id: "C", content: String.raw`$\sqrt{2}$` },
                          { id: "D", content: String.raw`$2$` }
                       ]}
                    />
                  </div>

                  {/* 编程题测试 */}
                  <div>
                    <h2 className="text-xl font-bold mb-4 shrink-0 text-slate-800">二、编程题测试</h2>
                    <ProgrammingQuestion
                       questionContent={String.raw`### 两数之和

给定一个整数数组 $nums$ 和一个整数目标值 $target$，请你在该数组中找出 **和为目标值** $target$ 的那 **两个** 整数，并返回它们的数组下标。

你可以假设每种输入只会对应一个答案。但是，数组中同一个元素在答案里不能重复出现。

你可以按任意顺序返回答案。

**示例 1：**
> **输入：** $nums = [2,7,11,15]$, $target = 9$  
> **输出：** $[0,1]$  
> **解释：** 因为 $nums[0] + nums[1] == 9$ ，返回 $[0, 1]$ 。
`}
                       language="javascript"
                       initialCode={`/**\n * @param {number[]} nums\n * @param {number} target\n * @return {number[]}\n */\nvar twoSum = function(nums, target) {\n    \n};`}
                       initialRunnerCode={`return twoSum([2, 7, 11, 15], 9);`}
                    />
                  </div>
                  {/* 填空题测试 */}
                  <div>
                    <h2 className="text-xl font-bold mb-4 shrink-0 text-slate-800">三、填空题测试</h2>
                    <FillInTheBlanksQuestion
                       questionContent={String.raw`世界上最高的山峰是 ___，它的海拔高度大约是 ___ 米。

已知的相对论质能方程为： ___，由物理学家 ___ 提出。请在下方写下你的计算思路，如：求 $\sqrt{16}$ 的结果是 \_\_\_。`}
                    />
                  </div>
               </div>
            </div>
          </div>

          {/* Resizable Drawer Panel Container for Animation */}
          <div 
            className={`shrink-0 overflow-hidden relative shadow-sm z-10 ${
              isDragging ? "transition-none" : "transition-all duration-300 ease-in-out"
            }`}
            style={{ width: activePanel ? drawerWidth : 0 }}
          >
            {/* Drawer Actual Content (Fixed Width to prevent squishing during animation) */}
            <div 
              className="flex flex-col bg-card h-full absolute top-0 left-0 border-l"
              style={{ width: drawerWidth }}
            >
              {/* Resizer Handle */}
              <div 
                className="absolute -left-1 top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/50 focus:bg-primary/50 group z-20"
                onMouseDown={handleMouseDown}
              >
                <div className="w-[1px] h-full bg-border mx-auto group-hover:bg-primary/50 transition-colors" />
              </div>

              <div className="p-4 font-semibold border-b flex items-center justify-between shrink-0 bg-muted/10 h-11">
                <span className="flex items-center gap-2 text-sm">
                    {activePanel === 'goals' && <><Target className="w-4 h-4 text-primary"/> 知识目标</>}
                    {activePanel === 'materials' && <><FileText className="w-4 h-4 text-primary"/> 课程素材</>}
                </span>
                <Button variant="ghost" size="icon" onClick={() => setActivePanel(null)} className="h-6 w-6 text-muted-foreground hover:text-foreground">
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
              
              <ScrollArea className="flex-1 p-4">
                {activePanel === 'goals' && (
                  <div className="space-y-3 animate-in fade-in zoom-in-95 duration-200">
                    <Card className="shadow-none border-dashed bg-muted/30">
                      <CardContent className="p-4">
                        <ul className="list-disc pl-4 space-y-1 text-sm">
                          <li>理解核心概念</li>
                          <li>掌握实践技能</li>
                          <li>完成进阶挑战</li>
                        </ul>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {activePanel === 'materials' && (
                  <div className="space-y-3 animate-in fade-in zoom-in-95 duration-200">
                    <Card className="shadow-none border-dashed bg-muted/30">
                      <CardContent className="p-4 flex flex-col gap-2">
                        <div className="flex items-center gap-2 text-sm p-3 hover:bg-muted rounded-md cursor-pointer transition-colors border border-transparent hover:border-border">
                          <FileText className="w-5 h-5 text-blue-500 shrink-0" />
                          <span className="truncate">第1章_导论.pdf</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm p-3 hover:bg-muted rounded-md cursor-pointer transition-colors border border-transparent hover:border-border">
                          <FileText className="w-5 h-5 text-green-500 shrink-0" />
                          <span className="truncate">学习指南_练习题.docx</span>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>

          {/* Narrow Icon Sidebar */}
          <aside className="w-14 shrink-0 flex flex-col items-center py-4 gap-3 bg-card border-l z-20 shadow-sm">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant={activePanel === 'goals' ? 'secondary' : 'ghost'} 
                  size="icon" 
                  className={`w-10 h-10 rounded-xl ${activePanel === 'goals' ? 'bg-primary/10 text-primary hover:bg-primary/20' : 'text-muted-foreground'}`}
                  onClick={() => togglePanel('goals')}
                >
                  <Target className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" className="font-medium">知识目标</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant={activePanel === 'materials' ? 'secondary' : 'ghost'} 
                  size="icon" 
                  className={`w-10 h-10 rounded-xl ${activePanel === 'materials' ? 'bg-primary/10 text-primary hover:bg-primary/20' : 'text-muted-foreground'}`}
                  onClick={() => togglePanel('materials')}
                >
                  <FileText className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" className="font-medium">课程素材</TooltipContent>
            </Tooltip>
          </aside>
        </main>
      </div>
    </TooltipProvider>
  );
}
