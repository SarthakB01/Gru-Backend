# Gru Backend

This is the backend server for the Gru AI learning platform.

## Setup

1. Install dependencies:
```bash
pnpm install
```

2. Create a `.env` file in the root directory with the following variables:

```env
# API Keys for AI Services
# Get your OpenRouter API key from: https://openrouter.ai/keys
OPENROUTER_API_KEY=your_openrouter_api_key_here

# Get your Hugging Face API key from: https://huggingface.co/settings/tokens
HUGGINGFACE_API_KEY=your_huggingface_api_key_here

# Get your Groq API key from: https://console.groq.com/keys
GROQ_API_KEY=your_groq_api_key_here
```

## API Keys Required

### OpenRouter API Key
- Used for primary text summarization with GPT-4
- Get your API key from: https://openrouter.ai/keys
- Provides access to GPT-4, Claude, and other advanced models
- Pay-per-use pricing

### Hugging Face API Key
- Used for text-to-speech functionality
- Get your free API key from: https://huggingface.co/settings/tokens
- Free tier includes 30,000 requests per month

### Groq API Key
- Used for chat and quiz generation
- Get your API key from: https://console.groq.com/keys
- Free tier includes 100 requests per minute

## Running the Server

```bash
pnpm dev
```

The server will start on port 5000.

## Features

- **Text Summarization**: Uses Groq API with Llama 3, falls back to Hugging Face
- **Chat**: AI-powered chat about uploaded documents
- **Quiz Generation**: Generate multiple-choice questions from content
- **File Upload**: Support for PDF and Word documents
- **Text-to-Speech**: Convert text to speech using Hugging Face models 