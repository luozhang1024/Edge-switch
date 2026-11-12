import React from "react";

// Render plain Markdown without HTML injection or external resource loading.
function inline(text: string): React.ReactNode[] {
  return text
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
    .map((part, index) =>
      part.startsWith("`") && part.endsWith("`") ? (
        <code key={index}>{part.slice(1, -1)}</code>
      ) : part.startsWith("**") && part.endsWith("**") ? (
        <strong key={index}>{part.slice(2, -2)}</strong>
      ) : (
        part
      ),
    );
}
export function SessionText({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const code = [];
      const language = line.slice(3);
      while (++i < lines.length && !lines[i].startsWith("```"))
        code.push(lines[i]);
      blocks.push(
        <pre className="sc-code" key={i}>
          <small>{language}</small>
          <code>{code.join("\n")}</code>
        </pre>,
      );
    } else if (/^#{1,6} /.test(line)) {
      blocks.push(<h4 key={i}>{inline(line.replace(/^#+ /, ""))}</h4>);
    } else if (/^\s*([-*]|\d+\.) /.test(line)) {
      const items = [line];
      while (i + 1 < lines.length && /^\s*([-*]|\d+\.) /.test(lines[i + 1]))
        items.push(lines[++i]);
      const entries = items.map((item, j) => (
        <li key={j}>{inline(item.replace(/^\s*([-*]|\d+\.) /, ""))}</li>
      ));
      blocks.push(
        /^\s*\d/.test(line) ? (
          <ol key={i}>{entries}</ol>
        ) : (
          <ul key={i}>{entries}</ul>
        ),
      );
    } else if (line.trim()) {
      const paragraph = [line];
      while (
        i + 1 < lines.length &&
        lines[i + 1].trim() &&
        !/^(#{1,6} |```|\s*([-*]|\d+\.) )/.test(lines[i + 1])
      )
        paragraph.push(lines[++i]);
      blocks.push(<p key={i}>{inline(paragraph.join("\n"))}</p>);
    }
  }
  return <div className="sc-markdown">{blocks}</div>;
}
