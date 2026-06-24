import type { ReactNode } from "react";

interface PagePlaceholderProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly tone: string;
  readonly children: ReactNode;
}

/** Shared hero-style header for the placeholder section pages. */
export function PagePlaceholder({
  eyebrow,
  title,
  tone,
  children,
}: PagePlaceholderProps) {
  return (
    <div className={`eu-page eu-page--${tone}`}>
      <p className="eu-page__eyebrow">{eyebrow}</p>
      <h1 className="eu-page__title">{title}</h1>
      <div className="eu-page__body">{children}</div>
    </div>
  );
}
