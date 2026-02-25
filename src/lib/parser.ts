export interface TodoItem {
  text: string;
  checked: boolean;
  line: number;
  descriptions: string[];
  today: boolean;
}

export interface TodoSection {
  title: string;
  level: number;
  items: TodoItem[];
  children: TodoSection[];
  priority: '!1' | '!2' | null;
}

export function parseTodoMd(content: string): TodoSection[] {
  const lines = content.split("\n");
  const root: TodoSection[] = [];
  const stack: { section: TodoSection; level: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match headings: ## !1 Title or ## Title
    const headingMatch = line.match(/^(#{1,6})\s+(?:(!1|!2)\s+)?(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const priority = (headingMatch[2] as '!1' | '!2') || null;
      const title = headingMatch[3].trim();
      const section: TodoSection = { title, level, items: [], children: [], priority };

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

    // Match checkbox items: - [ ] or - [x], with optional ★ prefix
    const checkboxMatch = line.match(/^[\s]*-\s+\[([ xX])\]\s+(?:(★)\s+)?(.+)$/);
    if (checkboxMatch && stack.length > 0) {
      const checked = checkboxMatch[1].toLowerCase() === "x";
      const today = checkboxMatch[2] === "★";
      const text = checkboxMatch[3].trim();
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

      stack[stack.length - 1].section.items.push({ text, checked, line: i, descriptions, today });
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

export function applyTodayToggle(
  rawContent: string,
  lineIndex: number,
  today: boolean
): string {
  const lines = rawContent.split("\n");
  if (lineIndex < 0 || lineIndex >= lines.length) return rawContent;
  const line = lines[lineIndex];
  if (today) {
    // Add ★ after checkbox
    lines[lineIndex] = line.replace(/(\[([ xX])\]\s+)/, "$1★ ");
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
