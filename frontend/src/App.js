import React, { useState } from 'react';
import './App.css';

function App() {
  const [question, setQuestion] = useState('');
  const [contextUrl, setContextUrl] = useState('');
  const [answer, setAnswer] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [urlError, setUrlError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validate URL if provided
      if (contextUrl && !isValidUrl(contextUrl)) {
        setUrlError('Please enter a valid URL');
        return;
      }
      setUrlError('');

      const response = await fetch('http://localhost:5000/api/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          question,
          contextUrl: contextUrl.trim() || undefined
        }),
      });

      const data = await response.json();
      if (response.ok) {
        setAnswer(data.answer);
        setImageUrl(data.imageUrl || ''); // Handle null imageUrl
      } else {
        setAnswer('Error: ' + data.error);
        setImageUrl('');
      }
    } catch (error) {
      setAnswer('Error: Could not connect to the server');
    } finally {
      setLoading(false);
    }
  };

  // URL validation helper
  const isValidUrl = (string) => {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>STS Vibe Assistant</h1>
        <div className="question-form">
          <form onSubmit={handleSubmit}>
            <input
              type="url"
              value={contextUrl}
              onChange={(e) => {
                setContextUrl(e.target.value);
                setUrlError('');
              }}
              placeholder="Optional: Add a URL for additional context"
              className={urlError ? 'error' : ''}
            />
            {urlError && <div className="error-message">{urlError}</div>}
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (question.trim() && !loading) {
                    handleSubmit(e);
                  }
                }
              }}
              placeholder="Ask a question about the STS User Guide... (Press Enter to submit)" 
              rows="4"
              disabled={loading}
            />
            <button type="submit" disabled={loading || !question.trim()}>
              {loading ? 'Asking...' : 'Ask Question'}
            </button>
          </form>
        </div>
        {loading ? (
          <div className="loading">
            <div className="loading-spinner"></div>
            <p>Finding the best answer for you...</p>
          </div>
        ) : answer && (
          <div className="answer">
            <div className="answer-content">
              <h2>Answer:</h2>
              <p>{answer}</p>
            </div>
            {imageUrl && (
              <div className="answer-image">
                <img src={imageUrl} alt="Relevant illustration" />
                <div className="image-loading" style={{ display: loading ? 'flex' : 'none' }}>
                  <div className="loading-spinner"></div>
                </div>
              </div>
            )}
          </div>
        )}
      </header>
    </div>
  );
}

export default App;
