import { markdownToHtml } from "../lib/utils";

export function MarkdownView({ markdown }) {
  return <div className="markdown-view" dangerouslySetInnerHTML={{ __html: markdownToHtml(markdown) }} />;
}
