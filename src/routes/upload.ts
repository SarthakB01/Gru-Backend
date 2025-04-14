import express from 'express';
import { authenticate } from '../middleware/authMiddleware';
import { upload } from '../utils/multerConfig'; // assuming you have a file upload setup like Multer

const router = express.Router();

// Protect the upload route with authentication middleware and handle file upload
router.post('/upload', authenticate, upload.single('file'), (req: express.Request, res: express.Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded.' });
    return;
  }

  res.status(200).json({ message: 'Upload route protected. File handling coming next!' });
});

export default router;
