import type { ReactNode } from "react";

const URL_PATTERN = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]*)/g;

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** Render plain-text paragraphs with safe, clickable http(s) links. */
export function MessageBodyParagraphs({
  paragraphs,
}: {
  paragraphs: readonly string[];
}) {
  if (!paragraphs.length) {
    return <p>No text content.</p>;
  }

  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <p key={`${index}-${paragraph.slice(0, 24)}`}>
          {linkify(paragraph)}
        </p>
      ))}
    </>
  );
}

function linkify(paragraph: string): ReactNode[] {
  const parts = paragraph.split(URL_PATTERN);
  return parts.map((part, index) => {
    if (!isHttpUrl(part)) {
      return <span key={`t-${index}`}>{part}</span>;
    }
    return (
      <a
        key={`a-${index}`}
        className="message-body-link"
        href={part}
        target="_blank"
        rel="noopener noreferrer"
      >
        {part}
      </a>
    );
  });
}
