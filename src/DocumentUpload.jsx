import { useCallback, useEffect, useState } from 'react';
import { ArrowUpFromLine, FileText, MessageSquare, RefreshCw, Trash2 } from 'lucide-react';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.txt'];

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const result = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (HTTP ${response.status}).`);
  return result;
}

function DocumentUpload() {
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState('uploading');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [uploadedDocument, setUploadedDocument] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [selectedIds, setSelectedIds] = useState(null);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [documentsError, setDocumentsError] = useState('');
  const [reprocessingId, setReprocessingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [question, setQuestion] = useState('');
  const [conversation, setConversation] = useState([]);
  const [chatError, setChatError] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  const applyDocuments = useCallback((result) => {
    const nextDocuments = result.documents || [];
    const readyIds = nextDocuments
      .filter((document) => document.status === 'ready')
      .map((document) => document.document_id);
    setDocuments(nextDocuments);
    setSelectedIds((previous) => previous === null
      ? readyIds
      : previous.filter((id) => readyIds.includes(id)));
  }, []);

  const loadDocuments = useCallback(async () => {
    try {
      const result = await requestJson('/api/documents');
      applyDocuments(result);
      setDocumentsError('');
    } catch (loadError) {
      setDocumentsError(loadError.message);
    } finally {
      setDocumentsLoading(false);
    }
  }, [applyDocuments]);

  useEffect(() => {
    let active = true;
    requestJson('/api/documents')
      .then((result) => {
        if (active) applyDocuments(result);
      })
      .catch((loadError) => {
        if (active) setDocumentsError(loadError.message);
      })
      .finally(() => {
        if (active) setDocumentsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applyDocuments]);

  const selectFile = (event) => {
    const selectedFile = event.target.files?.[0] ?? null;
    setUploadedDocument(null);
    setError('');
    setProgress(0);
    setUploadStage('uploading');

    if (!selectedFile) {
      setFile(null);
      return;
    }

    const extension = `.${selectedFile.name.split('.').pop()}`.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      setFile(null);
      event.target.value = '';
      setError('Choose a PDF, DOCX, or TXT file.');
      return;
    }
    if (selectedFile.size > MAX_FILE_SIZE) {
      setFile(null);
      event.target.value = '';
      setError('The file must be 10 MB or smaller.');
      return;
    }

    setFile(selectedFile);
  };

  const uploadFile = (event) => {
    event.preventDefault();
    if (!file || uploading) return;

    setError('');
    setUploadedDocument(null);
    setProgress(0);
    setUploadStage('uploading');
    setUploading(true);

    const formData = new FormData();
    formData.append('document', file);

    const request = new XMLHttpRequest();
    request.open('POST', '/api/documents/upload');
    request.responseType = 'json';
    request.upload.onprogress = (progressEvent) => {
      if (progressEvent.lengthComputable) {
        setProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100));
      }
    };
    request.onload = async () => {
      if (request.status === 202 && request.response?.document?.document_id) {
        setProgress(100);
        try {
          const document = await waitForProcessing(request.response.document.document_id);
          setUploadedDocument(document);
          setSelectedIds((previous) => [...new Set([...(previous || []), document.document_id])]);
        } catch (processingError) {
          setError(processingError.message);
        }
        setUploading(false);
        await loadDocuments();
      } else if (request.status >= 200 && request.status < 300 && request.response?.document?.status === 'ready') {
        setUploading(false);
        setProgress(100);
        setUploadedDocument(request.response.document);
        setSelectedIds((previous) => [...new Set([...(previous || []), request.response.document.document_id])]);
        await loadDocuments();
      } else {
        setUploading(false);
        setError(request.response?.error || 'The document was not fully processed.');
        await loadDocuments();
      }
      setFile(null);
    };
    request.onerror = () => {
      setUploading(false);
      setError('Could not connect to the document service. Make sure the project server is running.');
    };
    request.send(formData);
  };

  const waitForProcessing = async (documentId) => {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const result = await requestJson(`/api/documents/${documentId}/status`);
      if (result.document.status === 'ready') return result.document;
      if (result.document.status === 'failed') {
        throw new Error(result.document.error || 'Document processing failed.');
      }
      setUploadStage(result.document.stage);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error('Document processing is taking longer than expected. Refresh the document list to check its status.');
  };

  const toggleDocument = (documentId) => {
    setSelectedIds((previous) => {
      const current = previous || [];
      return current.includes(documentId)
        ? current.filter((id) => id !== documentId)
        : [...current, documentId];
    });
  };

  const selectAllDocuments = () => {
    setSelectedIds(readyDocuments.map((document) => document.document_id));
  };

  const reprocessDocument = async (documentId) => {
    setReprocessingId(documentId);
    setDocumentsError('');
    try {
      await requestJson(`/api/documents/${documentId}/reprocess`, { method: 'POST' });
      await loadDocuments();
    } catch (reprocessError) {
      await loadDocuments();
      setDocumentsError(reprocessError.message);
    } finally {
      setReprocessingId(null);
    }
  };

  const deleteDocument = async (document) => {
    if (!window.confirm(`Delete "${document.filename}" and its stored chunks?`)) return;
    setDeletingId(document.document_id);
    setDocumentsError('');
    try {
      await requestJson(`/api/documents/${document.document_id}`, { method: 'DELETE' });
      setSelectedIds((previous) => (previous || []).filter((id) => id !== document.document_id));
      await loadDocuments();
    } catch (deleteError) {
      setDocumentsError(deleteError.message);
    } finally {
      setDeletingId(null);
    }
  };

  const submitQuestion = async (event) => {
    event.preventDefault();
    if (!question.trim() || chatLoading || readyDocuments.length === 0) return;

    const submittedQuestion = question.trim();
    setQuestion('');
    setChatError('');
    setChatLoading(true);
    try {
      const result = await requestJson('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: submittedQuestion, documentIds: selectedIds || [] }),
      });
      setConversation((previous) => [...previous, {
        question: submittedQuestion,
        answer: result.answer,
        sources: result.sources || [],
      }]);
    } catch (questionError) {
      setChatError(questionError.message);
    } finally {
      setChatLoading(false);
    }
  };

  const readyDocuments = documents.filter((document) => document.status === 'ready');
  const selectedCount = (selectedIds || []).length;

  return (
    <section className="section document-upload">
      <div className="page-heading">
        <span>Private local document workspace</span>
        <h1>Ask your documents</h1>
        <p>Upload a PDF, DOCX, or TXT file, wait for processing, then ask questions using its contents.</p>
      </div>

      <form className="document-upload-card" onSubmit={uploadFile}>
        <label className="document-file-picker">
          <FileText size={30} aria-hidden="true" />
          <span>{file ? file.name : 'Choose a document from your device'}</span>
          <small>PDF, DOCX, or TXT · Up to 10 MB</small>
          <input
            type="file"
            accept=".pdf,.docx,.txt"
            onChange={selectFile}
            aria-label="Choose a document"
          />
        </label>

        {file && (
          <div className="document-file-details">
            <span>{file.name}</span>
            <small>{(file.size / (1024 * 1024)).toFixed(2)} MB</small>
          </div>
        )}

        {uploading && (
          <div className="upload-progress">
            <div className="upload-progress-label">
              <span>
                {({
                  uploading: 'Uploading document',
                  queued: 'Waiting to process',
                  extracting: 'Extracting text',
                  preprocessing: 'Cleaning extracted text',
                  chunking: 'Creating document chunks',
                  embedding: 'Generating embeddings',
                  vector_storage: 'Saving vectors to the database',
                })[uploadStage] || 'Processing document'}
              </span>
              <span>{uploadStage === 'uploading' ? `${progress}% transferred` : 'In progress'}</span>
            </div>
            <progress value={progress} max="100" aria-label={`Upload progress: ${progress}%`} />
          </div>
        )}

        {error && <div className="form-alert error" role="alert">{error}</div>}
        {uploadedDocument && (
          <div className="upload-success" role="status">
            <strong>Document processed and ready</strong>
            <span>{uploadedDocument.filename}</span>
            <small>{uploadedDocument.chunk_count} chunks indexed for chat.</small>
          </div>
        )}

        <button className="button primary document-upload-button" type="submit" disabled={!file || uploading}>
          <ArrowUpFromLine size={17} />
          {uploading ? 'Processing document...' : 'Upload and process'}
        </button>
      </form>

      <div className="document-library">
        <div className="document-library-heading">
          <div><span className="eyebrow">Local library</span><h2>Your documents</h2></div>
          <button
            className="button ghost"
            type="button"
            onClick={() => {
              setDocumentsLoading(true);
              loadDocuments();
            }}
            disabled={documentsLoading}
          >
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
        {documentsError && <div className="form-alert error" role="alert">{documentsError}</div>}
        {documentsLoading && <p className="document-muted">Loading document status...</p>}
        {!documentsLoading && documents.length === 0 && (
          <p className="document-muted">No documents yet. Upload one to start.</p>
        )}
        {documents.length > 0 && (
          <>
            <div className="document-selection-tools">
              <span>{selectedCount} ready document{selectedCount === 1 ? '' : 's'} selected</span>
              <button type="button" className="text-button" onClick={selectAllDocuments}>Select all ready</button>
            </div>
            <div className="document-list">
              {documents.map((document) => (
                <article className="document-row" key={document.document_id}>
                  {document.status === 'ready' && (
                    <input
                      type="checkbox"
                      checked={(selectedIds || []).includes(document.document_id)}
                      onChange={() => toggleDocument(document.document_id)}
                      aria-label={`Include ${document.filename} in chat`}
                    />
                  )}
                  <div className="document-row-main">
                    <strong>{document.filename}</strong>
                    <span className={`document-status ${document.status}`}>{document.status} · {document.stage}</span>
                    {document.error && <small className="document-error">{document.error}</small>}
                    {document.status === 'ready' && (
                      <small>{document.chunk_count} chunks{document.page_count ? ` · ${document.page_count} pages` : ''}</small>
                    )}
                  </div>
                  {document.status !== 'ready' && (
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => reprocessDocument(document.document_id)}
                      disabled={reprocessingId === document.document_id || deletingId === document.document_id}
                      aria-label={`Retry processing ${document.filename}`}
                    ><RefreshCw size={16} /></button>
                  )}
                  <button
                    type="button"
                    className="icon-button danger"
                    onClick={() => deleteDocument(document)}
                    disabled={deletingId === document.document_id || reprocessingId === document.document_id}
                    aria-label={`Delete ${document.filename}`}
                  ><Trash2 size={16} /></button>
                </article>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="document-chat">
        <div className="document-library-heading">
          <div><span className="eyebrow">Grounded answers</span><h2>Chat with your documents</h2></div>
          <MessageSquare className="chat-heading-icon" />
        </div>
        {readyDocuments.length === 0
          ? <p className="document-muted">A document must finish processing before you can ask questions.</p>
          : <p className="document-muted">Only the ready documents selected above will be searched.</p>}

        <div className="conversation" aria-live="polite">
          {conversation.map((turn, index) => (
            <article className="conversation-turn" key={`${turn.question}-${index}`}>
              <p className="conversation-question"><strong>You asked:</strong> {turn.question}</p>
              <p className="conversation-answer">{turn.answer}</p>
              {turn.sources.length > 0 && (
                <div className="answer-sources">
                  <strong>Sources</strong>
                  <ol>
                    {turn.sources.map((source) => (
                      <li key={source.chunk_id}>
                        {source.source_filename || 'Unknown document'}
                        {source.page_start !== null && ` — Page ${source.page_start}${source.page_end !== source.page_start ? `-${source.page_end}` : ''}`}
                        {source.section_name && ` — ${source.section_name}`}
                        <small>Similarity: {(source.similarity_score * 100).toFixed(1)}%</small>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </article>
          ))}
          {chatLoading && <p className="document-muted" role="status">Searching your documents and preparing a cited answer...</p>}
        </div>
        {chatError && <div className="form-alert error" role="alert">{chatError}</div>}
        <form className="chat-form" onSubmit={submitQuestion}>
          <label htmlFor="document-question">Your question</label>
          <textarea
            id="document-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask a question answered by your selected documents..."
            maxLength={2000}
            required
          />
          <button className="button primary" type="submit" disabled={chatLoading || readyDocuments.length === 0 || !selectedCount}>
            {chatLoading ? 'Searching...' : 'Ask question'}
          </button>
        </form>
      </div>
    </section>
  );
}

export default DocumentUpload;
