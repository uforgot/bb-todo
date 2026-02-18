"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TodoItem } from "@/components/todo-item";
import { countItems, type TodoSection as TodoSectionType } from "@/lib/parser";

interface TodoSectionProps {
  section: TodoSectionType;
  defaultOpen?: boolean;
  onToggle?: (lineIndex: number, checked: boolean) => void;
}

export function TodoSection({ section, defaultOpen = true, onToggle }: TodoSectionProps) {
  const { total, completed } = countItems([section]);
  const allDone = total > 0 && completed === total;

  return (
    <Card className="border-0 shadow-none rounded-none">
      <Accordion
        type="single"
        collapsible
        defaultValue={defaultOpen ? section.title : undefined}
      >
        <AccordionItem value={section.title} className="border-b">
          <AccordionTrigger className="px-4 py-2 hover:no-underline">
            <div className="flex items-center gap-2">
              <span
                className={`font-medium ${
                  allDone ? "text-muted-foreground" : ""
                }`}
              >
                {section.title}
              </span>
              {total > 0 && (
                <Badge
                  variant={allDone ? "default" : "outline"}
                  className="text-xs"
                >
                  {completed}/{total}
                </Badge>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <CardContent className="pt-0 pb-2">
              {section.items.length > 0 && (
                <div className="space-y-1">
                  {section.items.map((item, idx) => (
                    <TodoItem key={idx} item={item} onToggle={onToggle} />
                  ))}
                </div>
              )}
              {section.children.length > 0 && (
                <div className="mt-2 ml-2 space-y-2">
                  {section.children.map((child, idx) => (
                    <TodoSection
                      key={idx}
                      section={child}
                      defaultOpen={false}
                      onToggle={onToggle}
                    />
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
