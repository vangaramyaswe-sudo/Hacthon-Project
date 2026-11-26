import { useState } from 'react';
import { Bot, MessageCircle, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import DocumentUpload from './DocumentUpload';

function FloatingChatbot() {
  const location = useLocation();
  const [open, setOpen] = useState(false);

  if (location.pathname === '/documents') return null;

  return (
    <aside className="floating-chatbot">
      {open && (
        <section
          id="floating-chatbot-window"
          className="floating-chatbot-window"
          role="dialog"
          aria-modal="false"
          aria-labelledby="floating-chatbot-title"
        >
          <header className="floating-chatbot-header">
            <span className="floating-chatbot-icon"><Bot size={20} /></span>
            <div>
              <strong id="floating-chatbot-title">Document assistant</strong>
              <small>Answers grounded in your documents</small>
            </div>
            <button
              className="floating-chatbot-close"
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close document assistant"
            >
              <X size={20} />
            </button>
          </header>
          <DocumentUpload chatOnly />
        </section>
      )}
      <button
        className="floating-chatbot-launcher"
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-label={open ? 'Close document assistant' : 'Open document assistant'}
        aria-expanded={open}
        aria-controls={open ? 'floating-chatbot-window' : undefined}
      >
        {open ? <X size={25} /> : <MessageCircle size={25} />}
      </button>
    </aside>
  );
}

export default FloatingChatbot;
