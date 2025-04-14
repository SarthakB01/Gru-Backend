import express from 'express';
import dotenv from 'dotenv';
import uploadRoutes from './routes/upload'; // Import the upload routes
import authRoutes from './routes/auth';

import cors from 'cors';


dotenv.config();
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cors({
  origin: 'http://localhost:3000', // Allow frontend
  credentials: true               // Only needed if using cookies
}));


// Mount the upload route without '/api' prefix
app.use('/', uploadRoutes); // Make sure this path matches the one you're testing in Postman

app.use('/auth', authRoutes);

app.get('/', (req, res) => {
  res.send('Hello from backend');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
