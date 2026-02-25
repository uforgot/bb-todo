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
  isFlushing?: boolean;
  todayLines?: Set<number>;
}

function hasP1Items(section: TodoSectionType): boolean {
  if (section.items.some((item) => !item.checked && item.priority === "!1")) return true;
  return section.children.some(hasP1Items);
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

/* 소구분 (###) — Things식 Heading */
function ChildSection({ section, onToggle, isFlushing, todayLines }: { section: TodoSectionType; onToggle?: (lineIndex: number, checked: boolean) => void; isFlushing?: boolean; todayLines?: Set<number> }) {
  const { total, completed } = countItems([section]);

  return (
    <div className="mt-2 first:mt-0">
      <div className="flex items-center gap-2 pb-1 mb-0.5 border-b border-border/20">
        <span className="text-xs font-semibold text-muted-foreground">
          {section.title}
        </span>
        <CompletionCount completed={completed} total={total} />
      </div>
      <div>
        {section.items.map((item, idx) => (
          <TodoItem key={idx} item={item} onToggle={onToggle} disabled={isFlushing} dimmed={todayLines?.has(item.line)} />
        ))}
        {section.children.map((child, idx) => (
          <ChildSection key={idx} section={child} onToggle={onToggle} isFlushing={isFlushing} todayLines={todayLines} />
        ))}
      </div>
    </div>
  );
}

/* 대구분 (##) — Card + Accordion */
export function TodoSection({ section, defaultOpen = true, onToggle, isFlushing, todayLines }: TodoSectionProps) {
  const { total, completed } = countItems([section]);
  const allDone = total > 0 && completed === total;
  const showP1Accent = !allDone && hasP1Items(section);

  return (
    <Card className={`border shadow-none rounded-lg mb-1 ${allDone ? "border-border/30 opacity-60" : "border-border/50"} ${showP1Accent ? "border-l-4 border-l-[#EF4444]/40" : ""}`}>
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
                    <TodoItem key={idx} item={item} onToggle={onToggle} disabled={isFlushing} dimmed={todayLines?.has(item.line)} />
                  ))}
                </div>
              )}
              {section.children.length > 0 && (
                <div className={section.items.length > 0 ? "mt-1.5" : ""}>
                  {section.children.map((child, idx) => (
                    <ChildSection key={idx} section={child} onToggle={onToggle} isFlushing={isFlushing} todayLines={todayLines} />
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
