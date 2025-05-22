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
      },
    });

    res.json({ summary: result.summary_text });
  } catch (error) {
    console.error('Error in summarization:', error);
    res.status(500).json({ error: 'Failed to summarize text' });
  }
});

export default router;
