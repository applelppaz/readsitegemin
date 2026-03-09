import express from "express";
import { createServer as createViteServer } from "vite";
import * as cheerio from "cheerio";
import fetch from "node-fetch";
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorMessage = error?.message || "";
      const isRateLimit = errorMessage.includes("429") || errorMessage.includes("RESOURCE_EXHAUSTED");
      const isOverloaded = errorMessage.includes("503") || errorMessage.includes("overloaded");

      if ((isRateLimit || isOverloaded) && i < maxRetries - 1) {
        const delay = Math.pow(3, i) * 10000 + Math.random() * 5000;
        console.warn(`Gemini API rate limited (Attempt ${i + 1}/${maxRetries}), retrying in ${Math.round(delay / 1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

function splitIntoChunks(text: string, maxChunkSize: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChunkSize) {
      chunks.push(remaining);
      break;
    }

    // Look for the last sentence boundary within the chunk size limit
    // Search in the last 30% of the window for a sentence-ending character
    const searchStart = Math.floor(maxChunkSize * 0.7);
    const searchRegion = remaining.substring(searchStart, maxChunkSize);

    // Match sentence-ending punctuation (Western + CJK) followed by optional whitespace
    let splitAt = maxChunkSize;
    const sentenceEndRegex = /[.!?。！？\n]/g;
    let lastMatch: RegExpExecArray | null = null;
    let match: RegExpExecArray | null;
    while ((match = sentenceEndRegex.exec(searchRegion)) !== null) {
      lastMatch = match;
    }

    if (lastMatch) {
      splitAt = searchStart + lastMatch.index + lastMatch[0].length;
      // Skip trailing whitespace after the sentence end
      while (splitAt < remaining.length && /\s/.test(remaining[splitAt])) {
        splitAt++;
      }
    } else {
      // Fallback: split at last whitespace
      const lastSpace = remaining.lastIndexOf(" ", maxChunkSize);
      if (lastSpace > maxChunkSize * 0.5) {
        splitAt = lastSpace + 1;
      }
    }

    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt);
  }

  return chunks;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "5mb" }));

  // API route to fetch URL content
  app.post("/api/fetch-url", async (req, res) => {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.statusText}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Remove non-content elements
      $(
        "script, style, noscript, iframe, svg, canvas, " +
        "nav, footer, header, aside, " +
        "[role='navigation'], [role='banner'], [role='contentinfo'], [role='complementary'], " +
        ".nav, .footer, .header, .sidebar, .menu, .ads, .advertisement, .ad, .social-share, " +
        ".related-posts, .comments, .comment-section, #comments, " +
        "form, button, input, select, textarea"
      ).remove();

      // Find the best content element by selecting the one with the most text
      const candidates = [
        "article", "main", "[role='main']", ".post-content",
        ".entry-content", ".article-body", ".story-body", ".content",
        "#content", ".post", ".article", ".main-content"
      ];

      let contentElement: cheerio.Cheerio<any> = $("body");
      let maxLen = 0;

      for (const selector of candidates) {
        const el = $(selector);
        if (el.length > 0) {
          const len = el.first().text().length;
          if (len > maxLen) {
            maxLen = len;
            contentElement = el.first();
          }
        }
      }

      // Extract text from leaf-level block elements to avoid duplication
      const blockTags = new Set([
        "p", "h1", "h2", "h3", "h4", "h5", "h6", "li",
        "blockquote", "figcaption", "td", "th", "dt", "dd", "pre"
      ]);

      let extractedText = "";
      contentElement.find("*").each((_, el) => {
        const tagName = (el as any).tagName?.toLowerCase();
        if (!tagName) return;

        // For block-level tags, extract text
        if (blockTags.has(tagName)) {
          const text = $(el).text().trim();
          if (text.length > 0) {
            extractedText += text + "\n\n";
          }
          return;
        }

        // For div elements, only extract if they don't contain block children
        if (tagName === "div") {
          const hasBlockChild = $(el).find(Array.from(blockTags).join(", ")).length > 0;
          if (!hasBlockChild) {
            const text = $(el).text().trim();
            if (text.length > 0) {
              extractedText += text + "\n\n";
            }
          }
        }
      });

      // Fallback: if extracted text is too short, use full text of content element
      if (extractedText.length < 200) {
        extractedText = contentElement.text();
      }

      // Clean up whitespace but keep some newlines
      const cleanedText = extractedText
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n/g, "\n\n")
        .trim();

      const paragraphCount = cleanedText.split(/\n\n+/).filter(p => p.trim()).length;

      res.json({
        text: cleanedText,
        charCount: cleanedText.length,
        paragraphCount
      });
    } catch (error: any) {
      console.error("Error fetching URL:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API route to analyze text with Gemini
  app.post("/api/analyze", async (req, res) => {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    try {
      const model = "gemini-2.0-flash";
      const chunkSize = 12000;
      const textChunks = splitIntoChunks(text, chunkSize);

      let combinedResult: any = {
        summary: "",
        writingStyleAnalysis: "",
        culturalContext: "",
        sentencePatterns: [],
        tokens: [],
        partialAnalysis: false,
        analyzedChunks: 0,
        totalChunks: textChunks.length
      };

      for (let i = 0; i < textChunks.length; i++) {
        const isFirst = i === 0;
        const chunk = textChunks[i];

        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }

        const tokenizationRules = `
**CRITICAL - TOKEN GRANULARITY RULES (MUST FOLLOW EXACTLY):**
- Each token MUST be exactly ONE of: a single word, a punctuation mark, a whitespace character, an idiom (熟語), or a set phrase (成語/慣用句).
- A token's "text" field MUST NEVER contain more than 4 words (or 8 characters for CJK languages).
- ABSOLUTELY FORBIDDEN: putting a full sentence, a clause, or a long phrase as a single token.
- You MUST tokenize ALL text sequentially including every whitespace and punctuation character.

**CORRECT tokenization examples:**

English: "The quick brown fox jumped over the lazy dog."
→ tokens: "The", " ", "quick", " ", "brown", " ", "fox", " ", "jumped", " ", "over", " ", "the", " ", "lazy", " ", "dog", "."

Chinese: "他不但聪明而且勤奋。"
→ tokens: "他", "不但", "聪明", "而且", "勤奋", "。"

French: "Je suis allé au marché."
→ tokens: "Je", " ", "suis", " ", "allé", " ", "au", " ", "marché", "."

**WRONG (FORBIDDEN):**
- ❌ "The quick brown fox jumped over the lazy dog." as ONE token
- ❌ "他不但聪明而且勤奋" as ONE token
- ❌ Any token containing a full sentence or clause`;

        const prompt = isFirst ? `
Analyze the following text (Part 1 of ${textChunks.length}) for a language learner who wants to achieve native-level understanding.
The text could be in any language (e.g., English, Spanish, French, Chinese, Japanese, Korean, etc.).

**INSTRUCTIONS:**
1. IGNORE website UI elements (e.g., "Share", "Save", "Watch", "Like", "Subscribe", "Menu", etc.) that are not part of the actual article content.

${tokenizationRules}

3. Provide a brief summary of the ENTIRE text in Japanese.
4. Provide a detailed "Writing Style Analysis" in Japanese for the entire text.
5. Provide a "Cultural & Contextual Background" in Japanese, explaining any cultural references, historical context, or societal norms mentioned or implied in the text.
6. Identify key "Sentence Patterns" or grammatical structures used in this part.
7. Segment this part into tokens sequentially (including ALL characters).
8. For each token (except whitespace/punctuation):
   - Japanese translation. **If the language is Chinese, MUST include Pinyin (e.g., "こんにちは (nǐ hǎo)").**
   - Detailed explanation in Japanese. **CRITICAL: If the token is a proper noun, historical event, or cultural reference, provide a concise but comprehensive background explanation.**
   - Dictionary form (lemma) if the word is inflected.
   - Inflection details: Specify the EXACT conjugation or inflection used in the "type" field.

Text to analyze:
${chunk}
` : `
Analyze the following text (Part ${i + 1} of ${textChunks.length}) for a language learner.

**INSTRUCTIONS:**
1. IGNORE website UI elements that are not part of the actual article content.

${tokenizationRules}

3. Identify key "Sentence Patterns" or grammatical structures used in this part.
4. Segment this part into tokens sequentially (including ALL characters).
5. For each token (except whitespace/punctuation):
   - Japanese translation. **If the language is Chinese, MUST include Pinyin.**
   - Detailed explanation in Japanese. **CRITICAL: Provide deep background for proper nouns, cultural references, or specialized terms.**
   - Dictionary form (lemma).
   - Inflection details: Specify the EXACT conjugation or inflection used in the "type" field.

Text to analyze:
${chunk}
`;

        const schema: any = {
          type: Type.OBJECT,
          properties: {
            sentencePatterns: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  pattern: { type: Type.STRING },
                  explanation: { type: Type.STRING },
                  example: { type: Type.STRING }
                },
                required: ["pattern", "explanation", "example"]
              }
            },
            tokens: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  text: { type: Type.STRING, description: "A single word, punctuation, whitespace, or idiom. NEVER a full sentence." },
                  translation: { type: Type.STRING },
                  explanation: { type: Type.STRING },
                  lemma: { type: Type.STRING },
                  inflection: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING },
                      table: { type: Type.ARRAY, items: { type: Type.STRING } }
                    }
                  },
                  isPunctuation: { type: Type.BOOLEAN },
                  isWhitespace: { type: Type.BOOLEAN }
                },
                required: ["id", "text", "translation", "explanation"]
              }
            }
          },
          required: ["sentencePatterns", "tokens"]
        };

        if (isFirst) {
          schema.properties.summary = { type: Type.STRING };
          schema.properties.writingStyleAnalysis = { type: Type.STRING };
          schema.properties.culturalContext = { type: Type.STRING };
          schema.required.push("summary", "writingStyleAnalysis", "culturalContext");
        }

        let response;
        try {
          response = await withRetry(() => ai.models.generateContent({
            model,
            contents: [{ parts: [{ text: prompt }] }],
            config: {
              responseMimeType: "application/json",
              responseSchema: schema
            }
          }));
        } catch (error: any) {
          const msg = error?.message || "";
          if ((msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) && !isFirst) {
            console.warn(`Quota exhausted at chunk ${i}. Returning partial results.`);
            combinedResult.partialAnalysis = true;
            break;
          }
          throw error;
        }

        try {
          const result = JSON.parse(response.text || "{}");
          if (isFirst) {
            combinedResult.summary = result.summary;
            combinedResult.writingStyleAnalysis = result.writingStyleAnalysis;
            combinedResult.culturalContext = result.culturalContext;
          }
          combinedResult.sentencePatterns.push(...(result.sentencePatterns || []));
          combinedResult.tokens.push(...(result.tokens || []));
          combinedResult.analyzedChunks = i + 1;
        } catch (e) {
          console.error(`Failed to parse Gemini response for chunk ${i}:`, e);
          if (isFirst) throw new Error("Initial analysis failed");
          combinedResult.partialAnalysis = true;
          break;
        }
      }

      res.json(combinedResult);
    } catch (error: any) {
      console.error("Error analyzing text:", error);
      const msg = error.message || "Analysis failed";
      const status = msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") ? 429 : 500;
      res.status(status).json({ error: msg });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
