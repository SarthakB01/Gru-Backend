import express from 'express';
import dotenv from 'dotenv';
import uploadRoutes from './routes/upload'; // Import the upload routes
import authRoutes from './routes/auth';

dotenv.config();
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mount the upload route without '/api' prefix
app.use('/', uploadRoutes); // Make sure this path matches the one you're testing in Postman

app.use('/auth', authRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
