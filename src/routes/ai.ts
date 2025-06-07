import express, { Request, Response } from 'express';

const router = express.Router();

interface SummarizeRequest {
  text: string;
}

// Summarize text using Hugging Face Inference API
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

    // Dynamically import to support ESM module
    const { HfInference } = await import('@huggingface/inference');
    const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

    const result = await hf.summarization({
      model: 'facebook/bart-large-cnn',
      inputs: text,
      parameters: {
        max_length: 130,
        min_length: 30,
        do_sample: false,
        truncation: 'longest_first' // Using a valid truncation strategy
      },
    });

    if (!result || !result.summary_text) {
      throw new Error('No summary generated');
    }

    res.json({ summary: result.summary_text });
  } catch (error) {
    console.error('Error in summarization:', error);
    // Send more specific error message to client
    const errorMessage = error instanceof Error ? error.message : 'Failed to summarize text';
    res.status(500).json({ 
      error: 'Failed to summarize text',
      details: errorMessage
    });
  }
});

export default router;
