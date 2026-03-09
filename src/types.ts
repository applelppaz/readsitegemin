export interface InflectionInfo {
  type: string;
  table: string[];
}

export interface Token {
  id: string;
  text: string;
  translation: string;
  explanation: string;
  lemma?: string;
  inflection?: InflectionInfo;
  isPunctuation?: boolean;
  isWhitespace?: boolean;
}

export interface SentencePattern {
  pattern: string;
  explanation: string;
  example: string;
}

export interface AnalysisResult {
  summary: string;
  writingStyleAnalysis: string;
  culturalContext: string;
  sentencePatterns: SentencePattern[];
  tokens: Token[];
}
