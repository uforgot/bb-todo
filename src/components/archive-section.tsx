"use client";

import type { ArchiveProject, ArchiveCategory } from "@/hooks/use-archive";
import { Card } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

function ItemCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="text-xs tabular-nums text-green-500">
      {count}
    </span>
  );
}

function CategoryBlock({ category }: { category: ArchiveCategory }) {
  return (
    <div className="mt-2 first:mt-0">
      <div className="flex items-center gap-2 pb-1 mb-0.5 border-b border-border/20">
        <span className="text-xs font-semibold text-muted-foreground">
          {category.name}
        </span>
        <ItemCount count={category.items.length} />
      </div>
      <div>
        {category.items.map((item) => (
          <div key={item.id} className="flex items-center gap-2.5 py-1.5">
            <span className="size-5 shrink-0 flex items-center justify-center text-xs text-green-500">
              ✓
            </span>
            <span className="text-sm leading-snug text-pretty line-through text-muted-foreground">
              {item.title}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ArchiveSectionProps {
  project: ArchiveProject;
  defaultOpen?: boolean;
}

export function ArchiveSection({ project, defaultOpen = false }: ArchiveSectionProps) {
  const totalItems = project.items.length +
    project.categories.reduce((acc, c) => acc + c.items.length, 0);

  return (
    <Card className="border shadow-none rounded-lg mb-1 border-border/50">
      <Accordion type="single" collapsible defaultValue={defaultOpen ? "section" : undefined}>
        <AccordionItem value="section" className="border-0">
          <AccordionTrigger className="px-3 py-1 hover:no-underline hover:bg-accent/20 rounded-lg transition-colors">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-balance">
                {project.emoji ? `${project.emoji} ` : ""}{project.name}
              </span>
              <ItemCount count={totalItems} />
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-1.5">
            {/* Uncategorized items */}
            {project.items.length > 0 && (
              <div>
                {project.items.map((item) => (
                  <div key={item.id} className="flex items-center gap-2.5 py-1.5">
                    <span className="size-5 shrink-0 flex items-center justify-center text-xs text-green-500">
                      ✓
                    </span>
                    <span className="text-sm leading-snug text-pretty line-through text-muted-foreground">
                      {item.title}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {/* Categories */}
            {project.categories.length > 0 && (
              <div className={project.items.length > 0 ? "mt-1.5" : ""}>
                {project.categories.map((cat) => (
                  <CategoryBlock key={cat.id} category={cat} />
                ))}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}
