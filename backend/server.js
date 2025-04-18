require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const OpenAI = require('openai');
const axios = require('axios');
const cheerio = require('cheerio');
const url = require('url');

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

// Function to extract images from HTML
async function extractImages(pageUrl, html) {
  const $ = cheerio.load(html);
  const images = [];
  const baseUrl = pageUrl;

  $('img').each((_, element) => {
    const img = $(element);
    const src = img.attr('src');
    const alt = img.attr('alt') || '';
    const title = img.attr('title') || '';
    const width = img.attr('width');
    const height = img.attr('height');

    if (src) {
      const absoluteUrl = new URL(src, baseUrl).href;
      images.push({
        url: absoluteUrl,
        alt,
        title,
        width,
        height,
        description: [alt, title].filter(Boolean).join(' ')
      });
    }
  });

  return images;
}

// Function to find most relevant image
async function findRelevantImage(images, context) {
  if (images.length === 0) return null;

  // Use OpenAI to rank images based on their descriptions
  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content: "You are an image selection assistant. Choose the most relevant image based on the context. Return ONLY the index number (0-based) of the best matching image, nothing else."
      },
      {
        role: "user",
        content: `Context: ${context}\n\nAvailable images:\n${images.map((img, i) => 
          `${i}. ${img.description || 'No description'} (${img.url})`
        ).join('\n')}`
      }
    ],
    temperature: 0,
    max_tokens: 10
  });

  const selectedIndex = parseInt(response.choices[0].message.content.trim());
  return isNaN(selectedIndex) || selectedIndex >= images.length ? null : images[selectedIndex];
}

// Function to fetch URL content
async function fetchUrlContent(pageUrl) {
  try {
    const response = await axios.get(pageUrl, {
      headers: {
        'Accept': 'text/html,text/plain,application/json'
      },
      maxContentLength: 5 * 1024 * 1024, // 5MB limit
      timeout: 10000 // 10 second timeout
    });

    const contentType = response.headers['content-type'] || '';
    let content = response.data;
    let images = [];

    if (contentType.includes('text/html')) {
      // Extract images before cleaning HTML
      images = await extractImages(pageUrl, content);
      // Clean HTML content
      content = content.toString()
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Truncate content if it's too large
    const MAX_CHARS = 12000;
    if (content.length > MAX_CHARS) {
      const halfLength = Math.floor(MAX_CHARS / 2);
      content = content.slice(0, halfLength) + 
        '\n\n[Content truncated due to length...]\n\n' + 
        content.slice(-halfLength);
    }

    return { content, images };
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
    let urlContent = { content: '', images: [] };
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
          content: `Documentation Context:\n${guideContent}\n\nAdditional Context:\n${urlContent.content ? `Content from ${contextUrl}:\n${urlContent.content}\n\n` : ''}Question: ${question}`
        }
      ],
      temperature: 0.7,
      max_tokens: 1000
    });

    // Find a relevant image from the URL content if available
    let imageUrl = null;
    if (contextUrl && urlContent.images.length > 0) {
      try {
        const relevantImage = await findRelevantImage(urlContent.images, response.choices[0].message.content);
        if (relevantImage) {
          imageUrl = relevantImage.url;
        }
      } catch (imageError) {
        console.error('Image selection error:', imageError);
      }
    }

    res.json({ 
      answer: response.choices[0].message.content,
      imageUrl
    });
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
