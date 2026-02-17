"use client";

import { type TodoSection } from "@/lib/parser";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface ArchiveSectionProps {
  section: TodoSection;
  defaultOpen?: boolean;
}

export function ArchiveSection({ section, defaultOpen = false }: ArchiveSectionProps) {
  const total = section.items.length;
  const completed = section.items.filter((i) => i.checked).length;

  return (
    <Card className="border-b rounded-none border-x-0 shadow-none last:border-b-0">
      <Accordion type="single" collapsible defaultValue={defaultOpen ? "section" : undefined}>
        <AccordionItem value="section" className="border-b-0">
          <AccordionTrigger className="px-4 py-2.5 hover:no-underline">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{section.title}</span>
              {total > 0 && (
                <Badge variant={completed === total ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
                  {completed}/{total}
                </Badge>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-2">
            <div className="space-y-1">
              {section.items.map((item, idx) => (
                <div key={idx} className="flex items-start gap-3 py-1.5">
                  <span className={`text-sm ${item.checked ? "line-through text-muted-foreground" : ""}`}>
                    {item.checked ? "☑" : "☐"} {item.text}
                  </span>
                </div>
              ))}
            </div>
            {section.children.map((child, idx) => (
              <div key={idx} className="ml-3 mt-1">
                <ArchiveSection section={child} defaultOpen={defaultOpen} />
              </div>
            ))}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}
