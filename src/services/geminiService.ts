import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
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
        // Exponential backoff: 3s, 6s, 12s, 24s...
        const delay = Math.pow(2, i) * 3000 + Math.random() * 1000;
        console.warn(`Gemini API busy (Attempt ${i + 1}/${maxRetries}), retrying in ${Math.round(delay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function analyzeText(text: string): Promise<AnalysisResult> {
  // Switch to flash for better rate limit stability
  const model = "gemini-3-flash-preview";
  
  // Increase chunk size to 6000 to reduce number of API calls
  const chunkSize = 6000;
  const textChunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    textChunks.push(text.substring(i, i + chunkSize));
  }

  let combinedResult: AnalysisResult = {
    summary: "",
    writingStyleAnalysis: "",
    culturalContext: "",
    sentencePatterns: [],
    tokens: []
  };

  for (let i = 0; i < textChunks.length; i++) {
    const isFirst = i === 0;
    const chunk = textChunks[i];
    
    // Increase delay between chunks to 2 seconds to stay under rate limits
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    const prompt = isFirst ? `
      Analyze the following text (Part 1 of ${textChunks.length}) for a language learner who wants to achieve native-level understanding.
      The text could be in any language (e.g., English, Spanish, French, Chinese, etc.).

      **IMPORTANT INSTRUCTIONS:**
      1. IGNORE website UI elements (e.g., "Share", "Save", "Watch", "Like", "Subscribe", "Menu", etc.) that are not part of the actual article content.
      2. **STRICT WORD-LEVEL TOKENIZATION:** Every single token MUST be an individual word, a punctuation mark, or a whitespace character. 
         - **NEVER** group multiple words into a single token unless they form a strictly inseparable idiom (e.g., "by the way").
         - **NEVER** include a full sentence, a phrase, or a clause in a single token.
         - If you see a sentence like "The cat sat on the mat", you MUST provide tokens for "The", " ", "cat", " ", "sat", " ", "on", " ", "the", " ", "mat".
      3. Provide a brief summary of the ENTIRE text in Japanese.
      4. Provide a detailed "Writing Style Analysis" in Japanese for the entire text.
      5. Provide a "Cultural & Contextual Background" in Japanese, explaining any cultural references, historical context, or societal norms mentioned or implied in the text.
      6. Identify key "Sentence Patterns" or grammatical structures used in this part.
      7. Segment this part into tokens sequentially (including ALL characters).
      8. For each token (except whitespace/punctuation):
         - Japanese translation. **If the language is Chinese, MUST include Pinyin (e.g., "こんにちは (nǐ hǎo)").**
         - Detailed explanation. **CRITICAL: If the token is a proper noun, historical event, or cultural reference, provide a concise but comprehensive background explanation.**
         - Dictionary form (lemma) if the word is inflected.
         - Inflection details: Specify the EXACT conjugation or inflection used in the "type" field.
      
      Text to analyze:
      ${chunk}
    ` : `
      Analyze the following text (Part ${i + 1} of ${textChunks.length}) for a language learner.
      
      **IMPORTANT INSTRUCTIONS:**
      1. IGNORE website UI elements (e.g., "Share", "Save", "Watch", etc.) that are not part of the actual article content.
      2. **STRICT WORD-LEVEL TOKENIZATION:** Every single token MUST be an individual word, a punctuation mark, or a whitespace character.
         - **NEVER** group multiple words into a single token unless they form a strictly inseparable idiom.
         - **NEVER** include a full sentence, a phrase, or a clause in a single token.
      3. Identify key "Sentence Patterns" or grammatical structures used in this part.
      4. Segment this part into tokens sequentially (including ALL characters).
      5. For each token (except whitespace/punctuation):
         - Japanese translation. **If the language is Chinese, MUST include Pinyin.**
         - Detailed explanation. **CRITICAL: Provide deep background for proper nouns, cultural references, or specialized terms.**
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
              text: { type: Type.STRING },
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

    const response = await withRetry(() => ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: schema
      }
    }));

    try {
      const result = JSON.parse(response.text || "{}");
      if (isFirst) {
        combinedResult.summary = result.summary;
        combinedResult.writingStyleAnalysis = result.writingStyleAnalysis;
        combinedResult.culturalContext = result.culturalContext;
      }
      combinedResult.sentencePatterns.push(...(result.sentencePatterns || []));
      combinedResult.tokens.push(...(result.tokens || []));
    } catch (e) {
      console.error(`Failed to parse Gemini response for chunk ${i}:`, e);
      // If one chunk fails, we might still want to continue or throw
      if (isFirst) throw new Error("Initial analysis failed");
    }
  }

  return combinedResult;
}
