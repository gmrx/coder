export interface StructuredPresentationItem {
  title: string;
  subtitle?: string;
  meta?: string;
}

export interface StructuredPresentationSection {
  title: string;
  items: StructuredPresentationItem[];
}
