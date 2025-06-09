import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

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

export default router;
