export interface TodoItem {
  text: string;
  checked: boolean;
  line: number;
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

    // Match checkbox items: - [ ] or - [x]
    const checkboxMatch = line.match(/^[\s]*-\s+\[([ xX])\]\s+(.+)$/);
    if (checkboxMatch && stack.length > 0) {
      const checked = checkboxMatch[1].toLowerCase() === "x";
      const text = checkboxMatch[2].trim();
      stack[stack.length - 1].section.items.push({ text, checked, line: i });
    }
  }

  return root;
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
