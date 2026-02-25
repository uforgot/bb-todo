export interface TodoItem {
  text: string;
  checked: boolean;
  line: number;
  descriptions: string[];
  priority: '!1' | '!2' | null;
  today: boolean;
}

export interface TodoSection {
  title: string;
  level: number;
  items: TodoItem[];
  children: TodoSection[];
}

export function parseTodoMd(content: string): TodoSection[] {
  const lines = content.split("\n");
  const root: TodoSection[] = [];
  const stack: { section: TodoSection; level: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match headings: ## Title
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      const section: TodoSection = { title, level, items: [], children: [] };

      // Pop stack until we find a parent with lower level
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      if (stack.length === 0) {
        root.push(section);
      } else {
        stack[stack.length - 1].section.children.push(section);
      }

      stack.push({ section, level });
      continue;
    }

    // Match checkbox items: - [ ] or - [x], with optional !1/!2 and ★ prefixes
    const checkboxMatch = line.match(/^[\s]*-\s+\[([ xX])\]\s+(?:(!1|!2)\s+)?(?:(★)\s+)?(.+)$/);
    if (checkboxMatch && stack.length > 0) {
      const checked = checkboxMatch[1].toLowerCase() === "x";
      const priority = (checkboxMatch[2] as '!1' | '!2') || null;
      const today = checkboxMatch[3] === "★";
      const text = checkboxMatch[4].trim();
      const descriptions: string[] = [];

      // Look ahead for indented description lines (2+ spaces then "- text")
      let j = i + 1;
      while (j < lines.length) {
        const descMatch = lines[j].match(/^\s{2,}-\s+(.+)$/);
        if (descMatch) {
          descriptions.push(descMatch[1].trim());
          j++;
        } else {
          break;
        }
      }

      stack[stack.length - 1].section.items.push({ text, checked, line: i, descriptions, priority, today });
    }
  }

  return root;
}

export function applyToggles(
  rawContent: string,
  toggles: Map<number, boolean>
): string {
  const lines = rawContent.split("\n");

  for (const [lineIndex, checked] of toggles) {
    if (lineIndex < 0 || lineIndex >= lines.length) continue;
    const line = lines[lineIndex];
    // Replace [ ] with [x] or [x]/[X] with [ ]
    if (checked) {
      lines[lineIndex] = line.replace(/\[([ ])\]/, "[x]");
    } else {
      lines[lineIndex] = line.replace(/\[([xX])\]/, "[ ]");
    }
  }

  return lines.join("\n");
}

export function applyPriorityChange(
  rawContent: string,
  lineIndex: number,
  priority: '!1' | '!2' | null
): string {
  const lines = rawContent.split("\n");
  if (lineIndex < 0 || lineIndex >= lines.length) return rawContent;
  const line = lines[lineIndex];
  // Remove existing priority tag
  let updated = line.replace(/(\[([ xX])\]\s+)(?:!1|!2)\s+/, "$1");
  // Add new priority tag if specified
  if (priority) {
    updated = updated.replace(/(\[([ xX])\]\s+)/, `$1${priority} `);
  }
  lines[lineIndex] = updated;
  return lines.join("\n");
}

export function applyTodayToggle(
  rawContent: string,
  lineIndex: number,
  today: boolean
): string {
  const lines = rawContent.split("\n");
  if (lineIndex < 0 || lineIndex >= lines.length) return rawContent;
  const line = lines[lineIndex];
  if (today) {
    // Add ★ after checkbox (and after priority tag if present)
    lines[lineIndex] = line.replace(
      /(\[([ xX])\]\s+)(?:(!1|!2)\s+)?/,
      (_, prefix, __, prio) => prio ? `${prefix}${prio} ★ ` : `${prefix}★ `
    );
  } else {
    // Remove ★
    lines[lineIndex] = line.replace(/★\s+/, "");
  }
  return lines.join("\n");
}

export function countItems(sections: TodoSection[]): {
  total: number;
  completed: number;
} {
  let total = 0;
  let completed = 0;

  for (const section of sections) {
    total += section.items.length;
    completed += section.items.filter((item) => item.checked).length;
    const childCounts = countItems(section.children);
    total += childCounts.total;
    completed += childCounts.completed;
  }

  return { total, completed };
}
