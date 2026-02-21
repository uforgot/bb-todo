"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent } from "@/components/ui/card";
import { TodoItem } from "@/components/todo-item";
import { countItems, type TodoSection as TodoSectionType } from "@/lib/parser";

interface TodoSectionProps {
  section: TodoSectionType;
  defaultOpen?: boolean;
  onToggle?: (lineIndex: number, checked: boolean) => void;
}

function CompletionCount({ completed, total }: { completed: number; total: number }) {
  if (total === 0) return null;
  const allDone = completed === total;
  return (
    <span className={`text-xs tabular-nums ${allDone ? "text-green-500" : "text-muted-foreground"}`}>
      {completed}/{total}
    </span>
  );
}

/* 소구분 (###) — Things식 Heading: 아코디언 없이 텍스트 + 구분선 */
function ChildSection({ section, onToggle }: { section: TodoSectionType; onToggle?: (lineIndex: number, checked: boolean) => void }) {
  const { total, completed } = countItems([section]);

  return (
    <div className="mt-2 first:mt-0">
      {/* Heading */}
      <div className="flex items-center gap-2 pb-1 mb-0.5 border-b border-border/20">
        <span className="text-xs font-semibold text-muted-foreground">
          {section.title}
        </span>
        <CompletionCount completed={completed} total={total} />
      </div>
      {/* Items */}
      <div>
        {section.items.map((item, idx) => (
          <TodoItem key={idx} item={item} onToggle={onToggle} />
        ))}
        {section.children.map((child, idx) => (
          <ChildSection key={idx} section={child} onToggle={onToggle} />
        ))}
      </div>
    </div>
  );
}

/* 대구분 (##) — Card + Accordion 유지 */
export function TodoSection({ section, defaultOpen = true, onToggle }: TodoSectionProps) {
  const { total, completed } = countItems([section]);
  const allDone = total > 0 && completed === total;

  return (
    <Card className={`border shadow-none rounded-lg mb-1 ${allDone ? "border-border/30 opacity-60" : "border-border/50"}`}>
      <Accordion
        type="single"
        collapsible
        defaultValue={defaultOpen ? section.title : undefined}
      >
        <AccordionItem value={section.title} className="border-0">
          <AccordionTrigger className="px-3 py-1 hover:no-underline hover:bg-accent/20 rounded-lg transition-colors">
            <div className="flex items-center gap-2">
              <span className={`text-base font-semibold text-balance ${allDone ? "text-muted-foreground line-through" : ""}`}>
                {section.title}
              </span>
              <CompletionCount completed={completed} total={total} />
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <CardContent className="pt-0 pb-1.5 px-3">
              {section.items.length > 0 && (
                <div>
                  {section.items.map((item, idx) => (
                    <TodoItem key={idx} item={item} onToggle={onToggle} />
                  ))}
                </div>
              )}
              {section.children.length > 0 && (
                <div className={section.items.length > 0 ? "mt-1.5" : ""}>
                  {section.children.map((child, idx) => (
                    <ChildSection key={idx} section={child} onToggle={onToggle} />
                  ))}
                </div>
              )}
            </CardContent>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}
