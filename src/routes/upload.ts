import express from 'express';
import { upload } from '../utils/multerConfig';
import { requireAuth } from '@clerk/express';

const router = express.Router();

// Re-add requireAuth with proper error handling
router.post('/', requireAuth(), (req: express.Request, res: express.Response) => {
  console.log("Authentication successful, processing upload");
  
  upload.single('file')(req, res, (err: any) => {
    if (err) {
      console.error('File upload error:', err);
      return res.status(400).json({ error: 'Error during file upload: ' + err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    res.status(200).json({ 
      message: 'File uploaded successfully!', 
      filename: req.file.filename,
      path: req.file.path
    });
  });
});

export default router;