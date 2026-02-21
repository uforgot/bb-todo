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

function ChildSection({ section, onToggle }: { section: TodoSectionType; onToggle?: (lineIndex: number, checked: boolean) => void }) {
  const { total, completed } = countItems([section]);

  return (
    <div className="pl-3 border-l border-border/40">
      <Accordion type="single" collapsible defaultValue={undefined}>
        <AccordionItem value={section.title} className="border-0">
          <AccordionTrigger className="py-1 px-0 hover:no-underline hover:opacity-70 transition-opacity">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {section.title}
              </span>
              <CompletionCount completed={completed} total={total} />
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-0">
            <div className="space-y-0">
              {section.items.map((item, idx) => (
                <TodoItem key={idx} item={item} onToggle={onToggle} />
              ))}
              {section.children.map((child, idx) => (
                <ChildSection key={idx} section={child} onToggle={onToggle} />
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

export function TodoSection({ section, defaultOpen = true, onToggle }: TodoSectionProps) {
  const { total, completed } = countItems([section]);
  const allDone = total > 0 && completed === total;

  return (
    <Card className={`border shadow-none rounded-xl mb-1.5 ${allDone ? "border-border/30 opacity-60" : "border-border/50"}`}>
      <Accordion
        type="single"
        collapsible
        defaultValue={defaultOpen ? section.title : undefined}
      >
        <AccordionItem value={section.title} className="border-0">
          <AccordionTrigger className="px-3 py-2 hover:no-underline hover:bg-accent/20 rounded-xl transition-colors">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-semibold ${allDone ? "text-muted-foreground line-through" : ""}`}>
                {section.title}
              </span>
              <CompletionCount completed={completed} total={total} />
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <CardContent className="pt-0 pb-2 px-3">
              {section.items.length > 0 && (
                <div className="space-y-0">
                  {section.items.map((item, idx) => (
                    <TodoItem key={idx} item={item} onToggle={onToggle} />
                  ))}
                </div>
              )}
              {section.children.length > 0 && (
                <div className={`space-y-1 ${section.items.length > 0 ? "mt-2 pt-2 border-t border-border/30" : ""}`}>
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
