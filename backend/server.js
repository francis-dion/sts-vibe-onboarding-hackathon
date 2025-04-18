require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const OpenAI = require('openai');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 5000;

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(cors());
app.use(express.json());

// Function to read all markdown files in a directory
async function readMarkdownFiles(directory) {
  const files = await fs.readdir(directory);
  let content = '';
  
  for (const file of files) {
    const filePath = path.join(directory, file);
    const stat = await fs.stat(filePath);
    
    if (stat.isFile() && (file.endsWith('.md') || !path.extname(file))) {
      const fileContent = await fs.readFile(filePath, 'utf-8');
      content += `\n--- ${file} ---\n${fileContent}`;
    }
  }
  
  return content;
}

// Function to fetch URL content
async function fetchUrlContent(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'Accept': 'text/html,text/plain,application/json'
      },
      maxContentLength: 5 * 1024 * 1024, // 5MB limit
      timeout: 10000 // 10 second timeout
    });

    const contentType = response.headers['content-type'] || '';
    let content = response.data;

    // Handle different content types
    if (contentType.includes('application/json')) {
      content = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    } else if (contentType.includes('text/html')) {
      // Basic HTML cleanup - remove scripts and style tags
      content = content.toString()
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ') // Remove HTML tags
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
    }

    // Truncate content if it's too large for the OpenAI API
    const MAX_CHARS = 12000; // Leave room for system prompt and question
    if (content.length > MAX_CHARS) {
      const halfLength = Math.floor(MAX_CHARS / 2);
      content = content.slice(0, halfLength) + 
        '\n\n[Content truncated due to length...]\n\n' + 
        content.slice(-halfLength);
    }
    return content;
  } catch (error) {
    console.error('Error fetching URL:', {
      url,
      message: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
    throw new Error(`Failed to fetch URL content: ${error.message}`);
  }
}

// Endpoint to handle questions
app.post('/api/ask', async (req, res) => {
  try {
    const { question, contextUrl } = req.body;
    
    // Read the STS User Guide content
    const guideContent = await readMarkdownFiles(path.join(__dirname, '..', 'STS User Guide'));
    
    // Fetch URL content if provided
    let urlContent = '';
    if (contextUrl) {
      urlContent = await fetchUrlContent(contextUrl);
    }
    
    // Create the ChatGPT prompt
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that answers questions about the STS User Guide and any additional context provided. Use the provided documentation to answer questions accurately."
        },
        {
          role: "user",
          content: `Documentation Context:\n${guideContent}\n\nAdditional Context:\n${urlContent ? `Content from ${contextUrl}:\n${urlContent}\n\n` : ''}Question: ${question}`
        }
      ],
      temperature: 0.7,
      max_tokens: 1000
    });
    
    res.json({ answer: response.choices[0].message.content });
  } catch (error) {
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      response: error.response?.data
    });
    res.status(500).json({ error: `Error: ${error.message}` });
  }
});

// Basic health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
