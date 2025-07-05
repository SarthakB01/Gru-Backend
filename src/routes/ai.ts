import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { HfInference } from '@huggingface/inference';
import natural from 'natural';
import axios from 'axios';
import https from 'https';
import type { TfIdfTerm } from 'natural/lib/natural/tfidf';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.pdf', '.docx', '.doc'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and Word documents are allowed'));
    }
  }
});

interface SummarizeRequest {
  text: string;
}

// Initialize NLP tools
const tokenizer = new natural.WordTokenizer();
const TfIdf = natural.TfIdf;
const tfidf = new TfIdf();

// Helper function to extract text from different file types
async function extractTextFromFile(filePath: string, fileType: string): Promise<string> {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    
    switch (fileType) {
      case '.pdf':
        const pdfData = await pdfParse(fileBuffer);
        return pdfData.text;
      
      case '.docx':
      case '.doc':
        const result = await mammoth.extractRawText({ buffer: fileBuffer });
        return result.value;
      
      default:
        throw new Error('Unsupported file type');
    }
  } catch (error) {
    console.error('Error extracting text:', error);
    throw new Error('Failed to extract text from document');
  }
}

// Helper function to split text into chunks
function splitTextIntoChunks(text: string, maxChunkSize: number = 2000): string[] {
  const chunks: string[] = [];
  
  // Split by paragraphs first
  const paragraphs = text.split(/\n\s*\n/);
  let currentChunk = '';
  
  for (const paragraph of paragraphs) {
    // If a single paragraph is too long, split it by sentences
    if (paragraph.length > maxChunkSize) {
      const sentences = paragraph.split(/(?<=[.!?])\s+/);
      
      for (const sentence of sentences) {
        // If a single sentence is too long, split it by words
        if (sentence.length > maxChunkSize) {
          const words = sentence.split(/\s+/);
          let tempChunk = '';
          
          for (const word of words) {
            if (tempChunk.length + word.length + 1 > maxChunkSize) {
              if (tempChunk) {
                chunks.push(tempChunk.trim());
                tempChunk = word;
              } else {
                // If a single word is too long, split it
                const midPoint = Math.floor(maxChunkSize / 2);
                chunks.push(word.substring(0, midPoint));
                tempChunk = word.substring(midPoint);
              }
            } else {
              tempChunk += (tempChunk ? ' ' : '') + word;
            }
          }
          
          if (tempChunk) {
            currentChunk += (currentChunk ? ' ' : '') + tempChunk;
          }
        } else if (currentChunk.length + sentence.length + 1 > maxChunkSize) {
          chunks.push(currentChunk.trim());
          currentChunk = sentence;
        } else {
          currentChunk += (currentChunk ? ' ' : '') + sentence;
        }
      }
    } else if (currentChunk.length + paragraph.length + 2 > maxChunkSize) {
      chunks.push(currentChunk.trim());
      currentChunk = paragraph;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

// Helper function to check rate limits from response headers
function checkRateLimits(headers: Record<string, string>) {
  const remaining = headers['x-ratelimit-remaining'];
  const limit = headers['x-ratelimit-limit'];
  const reset = headers['x-ratelimit-reset'];
  
  if (remaining && limit) {
    console.log(`Rate Limit Status: ${remaining}/${limit} requests remaining`);
    if (parseInt(remaining) < 10) {
      console.warn('Warning: Approaching rate limit!');
    }
  }
  
  if (reset) {
    const resetTime = new Date(parseInt(reset) * 1000);
    console.log(`Rate limit resets at: ${resetTime.toLocaleString()}`);
  }
}

// Helper function to extract key concepts from text
function extractKeyConcepts(text: string): string[] {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const concepts: string[] = [];
  
  sentences.forEach(sentence => {
    const words = tokenizer.tokenize(sentence.toLowerCase());
    if (words) {
      // Add sentence to TF-IDF
      tfidf.addDocument(words);
      
      // Get important terms
      const terms = tfidf.listTerms(0);
      const importantTerms = terms
        .filter((term: TfIdfTerm) => term.tfidf > 0.5)
        .map((term: TfIdfTerm) => term.term);
      
      if (importantTerms.length > 0) {
        concepts.push(sentence.trim());
      }
    }
  });
  
  return concepts;
}

// Helper function to generate questions from a concept
function generateQuestion(concept: string): { question: string; options: string[]; correct: string } | null {
  // Split into sentences and clean up
  const sentences = concept
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (sentences.length === 0) {
    return null;
  }

  // Take the first complete sentence
  const sentence = sentences[0];
  const words = tokenizer.tokenize(sentence);
  
  if (!words || words.length < 5) {
    return null;
  }

  // Define important concepts and their related terms
  const conceptMap = {
    'artificial intelligence': ['machine learning', 'deep learning', 'neural networks', 'computer vision'],
    'learning': ['training', 'adaptation', 'improvement', 'development'],
    'reasoning': ['logic', 'deduction', 'inference', 'analysis'],
    'problem-solving': ['algorithms', 'solutions', 'strategies', 'methods'],
    'perception': ['sensing', 'recognition', 'understanding', 'interpretation'],
    'decision-making': ['choices', 'judgment', 'evaluation', 'selection'],
    'applications': ['uses', 'implementations', 'deployments', 'systems'],
    'research': ['study', 'investigation', 'development', 'exploration'],
    'goals': ['objectives', 'aims', 'targets', 'purposes'],
    'tools': ['techniques', 'methods', 'approaches', 'technologies'],
    'data': ['information', 'facts', 'statistics', 'knowledge'],
    'model': ['system', 'framework', 'structure', 'design'],
    'algorithm': ['procedure', 'process', 'method', 'technique'],
    'system': ['framework', 'structure', 'organization', 'setup'],
    'technology': ['innovation', 'development', 'advancement', 'progress']
  };

  // Find the main concept in the sentence
  let mainConcept = '';
  let relatedConcepts: string[] = [];
  
  for (const [concept, related] of Object.entries(conceptMap)) {
    if (sentence.toLowerCase().includes(concept)) {
      mainConcept = concept;
      relatedConcepts = related;
      break;
    }
  }

  if (!mainConcept) {
    // If no main concept found, try to extract key terms
    const keyTerms = words.filter((word: string) => word.length > 4);
    if (keyTerms.length > 0) {
      mainConcept = keyTerms[0];
      relatedConcepts = keyTerms.slice(1, 4);
    } else {
      return null;
    }
  }

  // Generate appropriate question based on the concept and sentence structure
  let question;
  const lowerSentence = sentence.toLowerCase();

  if (lowerSentence.includes('is the') || lowerSentence.includes('are the')) {
    question = `What is the definition of ${mainConcept}?`;
  } else if (lowerSentence.includes('include') || lowerSentence.includes('includes')) {
    question = `Which of the following is a key component of ${mainConcept}?`;
  } else if (lowerSentence.includes('founded') || lowerSentence.includes('established')) {
    question = `When was ${mainConcept} first established as a field of study?`;
  } else if (lowerSentence.includes('capability') || lowerSentence.includes('abilities')) {
    question = `What is a primary capability of ${mainConcept}?`;
  } else if (lowerSentence.includes('used') || lowerSentence.includes('uses')) {
    question = `What is the primary use of ${mainConcept}?`;
  } else if (lowerSentence.includes('important') || lowerSentence.includes('significance')) {
    question = `Why is ${mainConcept} important?`;
  } else {
    question = `Which of the following best describes ${mainConcept}?`;
  }

  // Generate meaningful options
  const options = [mainConcept];
  
  // Add related concepts as options
  options.push(...relatedConcepts);

  // If we need more options, add other relevant concepts
  const otherConcepts = Object.keys(conceptMap)
    .filter(concept => concept !== mainConcept)
    .slice(0, 4 - options.length);

  options.push(...otherConcepts);

  // Ensure we have exactly 4 options
  while (options.length < 4) {
    const randomConcept = Object.keys(conceptMap)[Math.floor(Math.random() * Object.keys(conceptMap).length)];
    if (!options.includes(randomConcept)) {
      options.push(randomConcept);
    }
  }

  // Shuffle options
  options.sort(() => Math.random() - 0.5);

  return {
    question: question.trim(),
    options: options.slice(0, 4),
    correct: mainConcept
  };
}

// Helper to calculate summary lengths
function getSummaryLengths(text: string) {
  const wordCount = text.split(/\s+/).length;
  // HuggingFace models use tokens, but word count is a good proxy
  // Most models have a max token limit (e.g., 1024 for BART, 512 for Pegasus-XSum)
  const maxModelLimit = 512;
  const minModelLimit = 30;
  let max_length = Math.floor(wordCount / 3);
  let min_length = Math.floor(wordCount / 4);
  if (max_length > maxModelLimit) max_length = maxModelLimit;
  if (min_length > max_length - 10) min_length = max_length - 10;
  if (min_length < minModelLimit) min_length = minModelLimit;
  return { max_length, min_length };
}

// Document summarization endpoint
const MAX_CHUNK_SIZE = 2000; // Adjust as needed for the model's real limit
router.post('/summarize-document', upload.single('document'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No document uploaded' });
      return;
    }

    const filePath = req.file.path;
    const fileType = path.extname(req.file.originalname).toLowerCase();

    // Extract text from document
    const text = await extractTextFromFile(filePath, fileType);
    
    if (!text || text.trim().length === 0) {
      res.status(400).json({ error: 'No text content found in the document' });
      return;
    }

    // Check for extremely large documents before chunking
    const MAX_TOTAL_CHARS = 40000; // Set as appropriate for your use case
    if (text.length > MAX_TOTAL_CHARS) {
      fs.unlinkSync(filePath);
      res.status(400).json({
        error: 'The uploaded document is too large to process.',
        details: `Your document has ${text.length} characters. The maximum allowed is ${MAX_TOTAL_CHARS}. Please upload a smaller file.`,
        currentCharCount: text.length,
        maxAllowedCharCount: MAX_TOTAL_CHARS
      });
      return;
    }

    // Split text into chunks if it's too long
    const chunks = splitTextIntoChunks(text);
    
    if (chunks.length === 0) {
      res.status(400).json({ error: 'No valid text content found in the document' });
      return;
    }

    console.log(`Processing document with ${chunks.length} chunks`);

    // Track skipped chunks due to size
    const skippedChunks: number[] = [];

    // Dynamically import to support ESM module
    const { HfInference } = await import('@huggingface/inference');
    const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

    // Summarize each chunk
    const summaries = await Promise.all(
      chunks.map(async (chunk, index) => {
        if (chunk.length > MAX_CHUNK_SIZE) {
          skippedChunks.push(index + 1); // 1-based index for user clarity
          return `[Skipped: Chunk ${index + 1} is too large for the summarization model]`;
        }
        try {
          console.log(`Processing chunk ${index + 1} of ${chunks.length}`);
          const { max_length, min_length } = getSummaryLengths(chunk);
          const result = await hf.summarization({
            model: 'google/pegasus-large',
            inputs: chunk,
            parameters: {
              max_length: Math.min(max_length, 150),
              min_length: Math.min(min_length, 50),
              do_sample: false,
              truncation: 'longest_first'
            },
          });

          // Check rate limits after each request
          if (result.headers) {
            checkRateLimits(result.headers as Record<string, string>);
          }

          console.log(`Successfully summarized chunk ${index + 1}`);
          return result.summary_text;
        } catch (error) {
          console.error(`Error summarizing chunk ${index + 1}:`, error);
          if (error instanceof Error) {
            // Check for rate limit errors
            if (error.message.includes('rate limit') || error.message.includes('429')) {
              console.error('Rate limit exceeded!');
              return `[Rate limit exceeded for section ${index + 1}]`;
            }
          }
          return `[Error summarizing section ${index + 1}]`;
        }
      })
    );

    // Clean up the uploaded file
    fs.unlinkSync(filePath);

    // Combine summaries
    const combinedSummary = summaries
      .filter(summary => !summary.startsWith('['))
      .join('\n\n');
    
    if (!combinedSummary) {
      res.status(500).json({ error: 'Failed to generate any summaries' });
      return;
    }
    
    res.json({ 
      summary: combinedSummary,
      metadata: {
        totalChunks: chunks.length,
        successfulSummaries: summaries.filter(s => !s.startsWith('[')).length,
        failedSummaries: summaries.filter(s => s.startsWith('[Error')).length,
        skippedChunks: skippedChunks,
        skippedChunksMessage: skippedChunks.length > 0
          ? `The following chunks were skipped because they exceeded the model's input size limit: ${skippedChunks.join(', ')}`
          : undefined
      }
    });
  } catch (error) {
    console.error('Error in document summarization:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to summarize document';
    res.status(500).json({ 
      error: 'Failed to summarize document',
      details: errorMessage
    });
  }
});

// Existing text summarization endpoint
router.post('/summarize', async (req: Request<{}, {}, SummarizeRequest>, res: Response) => {
  try {
    const { text } = req.body;

    if (!text) {
      res.status(400).json({ error: 'Text is required' });
      return;
    }

    // Check text length - increased limit for academic content
    if (text.length > 8000) {
      res.status(400).json({
        error: 'Text is too long. Please ensure it is under 8000 characters.',
        actualLength: text.length,
        currentCharCount: text.length,
        maxAllowedCharCount: 8000
      });
      return;
    }

    // Log API key status
    const apiKey = process.env.HUGGINGFACE_API_KEY;
    if (!apiKey) {
      console.error('HUGGINGFACE_API_KEY is not set in environment variables');
      res.status(500).json({ error: 'API configuration error' });
      return;
    }
    console.log('API Key is configured:', apiKey ? 'Yes' : 'No');

    // Dynamically import to support ESM module
    const { HfInference } = await import('@huggingface/inference');
    const hf = new HfInference(apiKey);

    console.log('Attempting to summarize text...');
    
    // Use Hugging Face for specialized summarization
    const hfApiKey = process.env.HUGGINGFACE_API_KEY;
    if (!hfApiKey) {
      res.status(500).json({ error: 'HUGGINGFACE_API_KEY is not set in environment variables' });
      return;
    }

    // Check if text is too long and needs chunking
    const MAX_TEXT_LENGTH = 4000; // Conservative limit for Hugging Face models
    let textToSummarize = text;
    
    if (text.length > MAX_TEXT_LENGTH) {
      console.log(`Text is too long (${text.length} chars), truncating to first ${MAX_TEXT_LENGTH} characters`);
      // Truncate to first MAX_TEXT_LENGTH characters, but try to end at a sentence
      textToSummarize = text.substring(0, MAX_TEXT_LENGTH);
      const lastPeriod = textToSummarize.lastIndexOf('.');
      const lastExclamation = textToSummarize.lastIndexOf('!');
      const lastQuestion = textToSummarize.lastIndexOf('?');
      
      const lastSentenceEnd = Math.max(lastPeriod, lastExclamation, lastQuestion);
      if (lastSentenceEnd > MAX_TEXT_LENGTH * 0.8) { // If we can find a sentence end in the last 20%
        textToSummarize = textToSummarize.substring(0, lastSentenceEnd + 1);
      }
      
      console.log(`Truncated text length: ${textToSummarize.length} characters`);
    }
    
    try {
      // Use a specialized summarization model
      const { HfInference } = await import('@huggingface/inference');
      const hf = new HfInference(hfApiKey);
      
      const result = await hf.summarization({
        model: 'facebook/bart-large-cnn', // Excellent for summarization
        inputs: textToSummarize,
        parameters: {
          max_length: 300,
          min_length: 100,
          do_sample: false,
          truncation: 'longest_first'
        },
      });

      const summary = result.summary_text;
      
      if (!summary) {
        throw new Error('No summary generated');
      }

            // Ensure the summary ends with proper punctuation
      let finalSummary = summary.trim();
      if (!finalSummary.endsWith('.') && !finalSummary.endsWith('!') && !finalSummary.endsWith('?')) {
        finalSummary += '.';
      }

      console.log('Summary generated successfully');
      res.json({ summary: finalSummary });
      
    } catch (error) {
      console.error('Error with Groq API:', error);
      res.status(500).json({ 
        error: 'Failed to generate summary',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  } catch (error) {
    console.error('Detailed error in summarization:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to summarize text';
    res.status(500).json({ 
      error: 'Failed to summarize text',
      details: errorMessage
    });
  }
});

// Quiz generation endpoint
router.post('/generate-quiz', upload.single('document'), async (req: Request, res: Response) => {
  try {
    let text = req.body.text;
    // If no text, but a file is uploaded, extract text from file
    if (!text && req.file) {
      const filePath = req.file.path;
      const fileType = path.extname(req.file.originalname).toLowerCase();
      text = await extractTextFromFile(filePath, fileType);
      // Clean up uploaded file
      fs.unlinkSync(filePath);
    }
    if (!text) {
      res.status(400).json({ error: 'Text is required' });
      return;
    }
    if (text.length > 4000) {
      res.status(400).json({
        error: 'Text is too long. Please ensure it is under 4000 characters',
        actualLength: text.length,
        currentCharCount: text.length,
        maxAllowedCharCount: 4000
      });
      return;
    }

    // Use Groq API for question generation
    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) {
      console.warn('GROQ_API_KEY is not set, falling back to Hugging Face');
      // Continue with Hugging Face fallback instead of returning error
    }
    const groqEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
    const prompt = `Generate 5 multiple-choice questions (with 4 options each and the correct answer marked with an asterisk *) based on the following text.\n\nText:\n${text}\n\nFormat:\nQ1: ...\nA. ...\nB. ...\nC. ...\nD. ...\nAnswer: ...\nQ2: ...\n...`;

    const payload = {
      model: 'llama3-70b-8192',
      messages: [
        { role: 'system', content: 'You are a helpful assistant that generates high-quality multiple-choice quizzes.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 1024,
      temperature: 0.7
    };

    if (!groqApiKey) {
      res.status(500).json({ 
        error: 'API key not configured', 
        details: 'GROQ_API_KEY is required for quiz generation. Please set up your API key.'
      });
      return;
    }

    const groqResponse = await axios.post(groqEndpoint, payload, {
      headers: {
        'Authorization': `Bearer ${groqApiKey}`,
        'Content-Type': 'application/json'
      },
      httpsAgent: new https.Agent({ keepAlive: true })
    });

    const content = groqResponse.data.choices?.[0]?.message?.content || '';

    // Parse the generated text into questions
    const quizQuestions = [];
    const questionBlocks = content.split(/Q\d+:/).slice(1);
    for (let i = 0; i < questionBlocks.length; i++) {
      const block = questionBlocks[i].trim();
      const lines = block.split('\n').map((l: string) => l.trim()).filter(Boolean);
      const question = lines[0];
      const options = [];
      let correct = '';
      for (const line of lines.slice(1)) {
        if (/^A\./i.test(line)) options.push(line.replace(/^A\.\s*/, ''));
        else if (/^B\./i.test(line)) options.push(line.replace(/^B\.\s*/, ''));
        else if (/^C\./i.test(line)) options.push(line.replace(/^C\.\s*/, ''));
        else if (/^D\./i.test(line)) options.push(line.replace(/^D\.\s*/, ''));
        else if (/^Answer:/i.test(line)) correct = line.replace(/^Answer:\s*/, '');
      }
      // If the correct answer is marked with *, remove the asterisk
      for (let j = 0; j < options.length; j++) {
        if (options[j].includes('*')) {
          correct = options[j].replace('*', '').trim();
          options[j] = correct;
        }
      }
      quizQuestions.push({
        id: i + 1,
        question,
        options,
        correct: correct
      });
    }

    res.json({
      quiz: {
        questions: quizQuestions
      }
    });
  } catch (error: any) {
    console.error('Error in quiz generation:', error?.response?.data || error);
    res.status(500).json({ error: 'Failed to generate quiz', details: error?.response?.data || error.message });
  }
});

// Text to speech endpoint
router.post('/text-to-speech', async (req: Request, res: Response) => {
  try {
    const { text } = req.body;

    if (!text) {
      res.status(400).json({ error: 'Text is required' });
      return;
    }

    const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

    // Generate speech using the text
    const result = await hf.textToSpeech({
      model: 'espnet/kan-bayashi_ljspeech_tts_train_tacotron2_raw_phn_tacotron_g2p_en_no_space_train',  // Changed to a free model
      inputs: text,
    });

    // Convert the audio data to base64
    const audioBase64 = Buffer.from(await result.arrayBuffer()).toString('base64');

    res.json({ 
      audio: audioBase64,
      format: 'audio/wav'
    });
  } catch (error) {
    console.error('Error in text-to-speech:', error);
    res.status(500).json({ error: 'Failed to generate speech' });
  }
});

// Answer verification endpoint
router.post('/verify-answers', async (req: Request, res: Response) => {
  try {
    const { answers } = req.body;
    
    if (!answers || !Array.isArray(answers)) {
      res.status(400).json({ error: 'Invalid answers format' });
      return;
    }

    const results = answers.map(answer => {
      if (!answer.selectedAnswer || !answer.correctAnswer) {
        return {
          questionId: answer.questionId,
          question: answer.question,
          selectedAnswer: answer.selectedAnswer || '',
          correctAnswer: answer.correctAnswer || '',
          isCorrect: false,
          feedback: 'No answer provided or correct answer missing.'
        };
      }
      const isCorrect = String(answer.selectedAnswer).toLowerCase() === String(answer.correctAnswer).toLowerCase();
      return {
        questionId: answer.questionId,
        question: answer.question,
        selectedAnswer: answer.selectedAnswer,
        correctAnswer: answer.correctAnswer,
        isCorrect,
        feedback: isCorrect ? 'Correct!' : `Incorrect. The correct answer is: ${answer.correctAnswer}`
      };
    });

    const score = results.filter(r => r.isCorrect).length;
    const total = results.length;
    const percentage = (score / total) * 100;

    res.json({
      results,
      summary: {
        score,
        total,
        percentage,
        feedback: getFeedback(percentage)
      }
    });
  } catch (error) {
    console.error('Error verifying answers:', error);
    res.status(500).json({ error: 'Failed to verify answers' });
  }
});

// Helper function to generate feedback based on score
function getFeedback(percentage: number): string {
  if (percentage >= 90) {
    return 'Excellent! You have a deep understanding of the material.';
  } else if (percentage >= 70) {
    return 'Good job! You have a solid grasp of the key concepts.';
  } else if (percentage >= 50) {
    return 'Not bad! You understand the basics, but there\'s room for improvement.';
  } else {
    return 'Keep studying! Focus on understanding the main concepts better.';
  }
}

// Chat with Gru about your document
router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { question, context } = req.body;
    if (!question || !context) {
      res.status(400).json({ error: 'Question and context are required' });
      return;
    }
    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) {
      console.warn('GROQ_API_KEY is not set, falling back to Hugging Face');
      // Continue with Hugging Face fallback instead of returning error
    }
    const groqEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
    const prompt = `Your name is Gru, an AI tutor. Answer the user's question based on the following context.\n\nContext:\n${context}\n\nQuestion: ${question}`;
    const payload = {
      model: 'llama3-70b-8192',
      messages: [
        { role: 'system', content: 'You are a helpful and knowledgeable study assistant. Answer questions clearly and concisely based only on the provided context.' },
        // { role: 'system', content: 'You are Gru, an AI tutor that answers questions based on provided context.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 512,
      temperature: 0.7
    };
    if (!groqApiKey) {
      res.status(500).json({ 
        error: 'API key not configured', 
        details: 'GROQ_API_KEY is required for chat functionality. Please set up your API key.'
      });
      return;
    }

    const groqResponse = await axios.post(groqEndpoint, payload, {
      headers: {
        'Authorization': `Bearer ${groqApiKey}`,
        'Content-Type': 'application/json'
      },
      httpsAgent: new https.Agent({ keepAlive: true })
    });
    const content = groqResponse.data.choices?.[0]?.message?.content || '';
    res.json({ answer: content });
  } catch (error: any) {
    console.error('Error in chat endpoint:', error?.response?.data || error);
    res.status(500).json({ error: 'Failed to get answer', details: error?.response?.data || error.message });
  }
});

export default router;
