import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { HfInference } from '@huggingface/inference';
import natural from 'natural';

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
        .filter(term => term.tfidf > 0.5)
        .map(term => term.term);
      
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

  // Find potential key terms (nouns and important words)
  const keyTerms = words.filter(word => {
    const lowerWord = word.toLowerCase();
    return (
      word.length > 3 && 
      !['the', 'and', 'that', 'this', 'with', 'from', 'have', 'they', 'their', 'there', 'about', 'what', 'when', 'where', 'which', 'who', 'why', 'how', 'remember', 'think', 'know', 'was', 'were', 'will', 'would', 'could', 'should', 'might', 'may', 'must', 'very', 'much', 'many', 'some', 'any', 'all', 'none', 'both', 'either', 'neither', 'each', 'every', 'few', 'several', 'most', 'more', 'less', 'least', 'most', 'more', 'less', 'least'].includes(lowerWord)
    );
  });

  if (keyTerms.length < 2) {
    return null;
  }

  // Select a term to use in the question
  const termToUse = keyTerms[Math.floor(Math.random() * keyTerms.length)];
  
  // Create a question based on the sentence structure
  let question;
  if (sentence.toLowerCase().includes('is') || sentence.toLowerCase().includes('are')) {
    question = sentence.replace(termToUse, '_____');
  } else {
    // Create a "What is" or "Which of the following" question
    const questionType = Math.random() > 0.5 ? 'What is' : 'Which of the following';
    question = `${questionType} ${termToUse.toLowerCase()}?`;
  }

  // Generate options
  const options = [termToUse];
  
  // Add other key terms as options
  const otherTerms = keyTerms
    .filter(term => term !== termToUse)
    .slice(0, 3);

  options.push(...otherTerms);

  // If we need more options, add variations of the correct answer
  while (options.length < 4) {
    const baseTerm = termToUse;
    let newOption = '';
    
    if (baseTerm.endsWith('s')) {
      newOption = baseTerm.slice(0, -1);
    } else if (baseTerm.endsWith('y')) {
      newOption = baseTerm.slice(0, -1) + 'ies';
    } else {
      newOption = baseTerm + 's';
    }
    
    if (!options.includes(newOption)) {
      options.push(newOption);
    }
  }

  // Shuffle options
  options.sort(() => Math.random() - 0.5);

  return {
    question: question.trim(),
    options: options.slice(0, 4),
    correct: termToUse
  };
}

// Helper function to refine questions using LLM
async function refineQuestions(questions: { question: string; options: string[]; correct: string }[]): Promise<{ question: string; options: string[]; correct: string }[]> {
  try {
    const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);
    
    const refinedQuestions = await Promise.all(questions.map(async (q) => {
      const prompt = `Improve this quiz question to make it more engaging and educational while keeping the same meaning and correct answer:
      Question: ${q.question}
      Options: ${q.options.join(', ')}
      Correct Answer: ${q.correct}
      
      Return the improved question and options in JSON format:
      {
        "question": "improved question",
        "options": ["option1", "option2", "option3", "option4"],
        "correct": "${q.correct}"
      }`;

      try {
        const result = await hf.textGeneration({
          model: 'bigscience/bloom-560m',
          inputs: prompt,
          parameters: {
            max_new_tokens: 200,
            temperature: 0.7,
            top_p: 0.95,
            return_full_text: false
          }
        });

        try {
          const refined = JSON.parse(result.generated_text);
          return {
            question: refined.question,
            options: refined.options,
            correct: q.correct // Keep the original correct answer
          };
        } catch (error) {
          console.error('Error parsing refined question:', error);
          return q; // Return original question if parsing fails
        }
      } catch (error) {
        console.error('Error refining question:', error);
        return q; // Return original question if refinement fails
      }
    }));

    return refinedQuestions;
  } catch (error) {
    console.error('Error in question refinement:', error);
    return questions; // Return original questions if refinement fails
  }
}

// Document summarization endpoint
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

    // Split text into chunks if it's too long
    const chunks = splitTextIntoChunks(text);
    
    if (chunks.length === 0) {
      res.status(400).json({ error: 'No valid text content found in the document' });
      return;
    }

    console.log(`Processing document with ${chunks.length} chunks`);

    // Dynamically import to support ESM module
    const { HfInference } = await import('@huggingface/inference');
    const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

    // Summarize each chunk
    const summaries = await Promise.all(
      chunks.map(async (chunk, index) => {
        try {
          console.log(`Processing chunk ${index + 1} of ${chunks.length}`);
          const result = await hf.summarization({
            model: 'google/pegasus-xsum',  // Using the same model that works for text
            inputs: chunk,
            parameters: {
              max_length: 130,
              min_length: 30,
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
        failedSummaries: summaries.filter(s => s.startsWith('[')).length
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

    // Check text length (BART model has a limit of 1024 tokens)
    if (text.length > 4000) {
      res.status(400).json({ error: 'Text is too long. Please provide text under 4000 characters.' });
      return;
    }

    // Log API key status (without exposing the actual key)
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
    const result = await hf.summarization({
      model: 'google/pegasus-xsum',
      inputs: text,
      parameters: {
        max_length: 130,
        min_length: 30,
        do_sample: false,
        truncation: 'longest_first'
      },
    });

    if (!result || !result.summary_text) {
      console.error('No summary generated from API response:', result);
      throw new Error('No summary generated');
    }

    console.log('Summary generated successfully');
    res.json({ summary: result.summary_text });
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
router.post('/generate-quiz', async (req: Request, res: Response) => {
  try {
    const { text } = req.body;

    if (!text) {
      res.status(400).json({ error: 'Text is required' });
      return;
    }

    // Split text into chunks for better question generation
    const chunks: string[] = text.split(/\n\n+/).filter((chunk: string) => chunk.trim().length > 0);
    
    // Generate questions from each chunk
    let questions = [];
    for (const chunk of chunks) {
      const question = generateQuestion(chunk);
      if (question) {
        questions.push(question);
        if (questions.length >= 5) break; // Stop once we have 5 questions
      }
    }

    // If we don't have enough questions, try to generate more from the same chunks
    while (questions.length < 5 && chunks.length > 0) {
      for (const chunk of chunks) {
        const question = generateQuestion(chunk);
        if (question && !questions.some(q => q.question === question.question)) {
          questions.push(question);
          if (questions.length >= 5) break;
        }
      }
    }

    if (questions.length === 0) {
      res.status(400).json({ error: 'Could not generate questions from the provided text' });
      return;
    }

    // Ensure we have exactly 5 questions
    questions = questions.slice(0, 5);

    // Refine questions using LLM
    const refinedQuestions = await refineQuestions(questions);

    res.json({ 
      quiz: {
        questions: refinedQuestions.map((q, index) => ({
          ...q,
          id: index + 1 // Add question ID for answer verification
        }))
      }
    });
  } catch (error) {
    console.error('Error in quiz generation:', error);
    res.status(500).json({ error: 'Failed to generate quiz' });
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
      const isCorrect = answer.selectedAnswer.toLowerCase() === answer.correctAnswer.toLowerCase();
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

export default router;
