"use client";

import { type TodoSection } from "@/lib/parser";
import { Card } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

function CompletionCount({ completed, total }: { completed: number; total: number }) {
  if (total === 0) return null;
  const allDone = completed === total;
  return (
    <span className={`text-xs tabular-nums ${allDone ? "text-green-500" : "text-muted-foreground"}`}>
      {completed}/{total}
    </span>
  );
}

function ArchiveChild({ section }: { section: TodoSection }) {
  const total = section.items.length;
  const completed = section.items.filter((i) => i.checked).length;

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
          <div key={idx} className="flex items-center gap-2.5 py-1.5">
            <span className={`size-5 shrink-0 flex items-center justify-center text-xs ${item.checked ? "text-green-500" : "text-muted-foreground"}`}>
              {item.checked ? "✓" : "○"}
            </span>
            <span className={`text-sm leading-snug text-pretty ${item.checked ? "line-through text-muted-foreground" : ""}`}>
              {item.text}
            </span>
          </div>
        ))}
        {section.children.map((child, idx) => (
          <ArchiveChild key={idx} section={child} />
        ))}
      </div>
    </div>
  );
}

interface ArchiveSectionProps {
  section: TodoSection;
  defaultOpen?: boolean;
}

export function ArchiveSection({ section, defaultOpen = false }: ArchiveSectionProps) {
  const total = section.items.length + section.children.reduce((acc, c) => acc + c.items.length, 0);
  const completed = section.items.filter((i) => i.checked).length + section.children.reduce((acc, c) => acc + c.items.filter((i) => i.checked).length, 0);

  return (
    <Card className="border shadow-none rounded-lg mb-1 border-border/50">
      <Accordion type="single" collapsible defaultValue={defaultOpen ? "section" : undefined}>
        <AccordionItem value="section" className="border-0">
          <AccordionTrigger className="px-3 py-1 hover:no-underline hover:bg-accent/20 rounded-lg transition-colors">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-balance">{section.title}</span>
              <CompletionCount completed={completed} total={total} />
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-1.5">
            <div>
              {section.items.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2.5 py-1.5">
                  <span className={`size-5 shrink-0 flex items-center justify-center text-xs ${item.checked ? "text-green-500" : "text-muted-foreground"}`}>
                    {item.checked ? "✓" : "○"}
                  </span>
                  <span className={`text-sm leading-snug text-pretty ${item.checked ? "line-through text-muted-foreground" : ""}`}>
                    {item.text}
                  </span>
                </div>
              ))}
            </div>
            {section.children.length > 0 && (
              <div className={section.items.length > 0 ? "mt-1.5" : ""}>
                {section.children.map((child, idx) => (
                  <ArchiveChild key={idx} section={child} />
                ))}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}
