# Hackathon Registration Event

This project uses React 19, Vite, and React Router for the website. Firebase Authentication and Firestore support organiser login, feedback, and structured registrations. LanceDB is reserved for document vectors and chunks.

## Run locally

Install dependencies and copy `.env.example` to `.env.local`. Set the OpenAI key and Firebase server configuration:

```text
OPENAI_API_KEY=your-key
FIREBASE_PROJECT_ID=your-firebase-project-id
GOOGLE_APPLICATION_CREDENTIALS=absolute-path-to-service-account-json
ORGANIZER_EMAILS=verified-organiser@example.com
```

Enable Email/Password sign-in and Firestore in the Firebase project. Create a server service account with Firebase Authentication token-verification and Firestore access, download its JSON file outside version control, and set `GOOGLE_APPLICATION_CREDENTIALS` to its absolute Windows path. Add organiser account emails to `ORGANIZER_EMAILS` (comma-separated); an organiser account must have a verified email. Server-side Firebase Admin also accepts trusted Google Application Default Credentials or `FIREBASE_SERVICE_ACCOUNT_JSON`.

Deploy the included Firestore rules so clients cannot read registration records or uniqueness keys. Public feedback submissions remain validated, while feedback reads go through the organiser-authenticated backend:

```sh
firebase use your-firebase-project-id
firebase deploy --only firestore:rules
```

Keep all server credentials private. `.env.local` is ignored by Git; Firebase web app values prefixed with `VITE_` are public client configuration, while the service account and OpenAI key are used only by the backend. Then run:

```sh
npm install
npm run dev
```

Open the local address printed by Vite and choose **Documents** in the top navigation. Vite starts the React site and the Express API together. The API listens only on `127.0.0.1`.

## Document RAG workflow

The Documents page accepts PDF, DOCX, and UTF-8 TXT files up to 10 MB. The backend validates and extracts text, preprocesses it, creates chunks, generates OpenAI embeddings, and saves chunk text and metadata in a persistent local LanceDB vector store. The page polls document status during processing, including the embedding and vector-storage stages. A document is shown as ready only after all processing and vector storage succeeds.

When you ask a question, the API embeds it with the same configured embedding model, searches only the ready documents you selected, filters low-similarity results, and sends the question separately from the retrieved context to the configured chat model. Answers must cite retrieved chunk IDs; the UI displays source filenames, page ranges (when available), section names, and similarity. If retrieval is insufficient or citations are invalid, the chatbot returns:

> I couldn't find the answer in the uploaded documents. Please upload a relevant document or ask a question related to the available documents.

Use the document list to retry failed processing or delete a document and its vector records. Re-uploading identical file contents reuses the existing processed document rather than creating duplicate vectors.

## Local configuration

Configuration can be changed in `.env.local`. Defaults are listed in `.env.example`.

- `OPENAI_EMBEDDING_MODEL` defaults to `text-embedding-3-small`; document and question embeddings always use this same model.
- `OPENAI_CHAT_MODEL` defaults to `gpt-4o-mini`.
- `RAG_CHUNK_SIZE_CHARS` and `RAG_CHUNK_OVERLAP_CHARS` default to 2,000 and 200 characters. No tokenizer is installed, so these are character targets, not guaranteed token counts.
- `RAG_TOP_K`, `RAG_SIMILARITY_THRESHOLD`, and `RAG_MAX_CONTEXT_CHARS` control retrieval and context size.
- `RAG_DATA_DIR` stores the local document registry, uploaded originals, and raw/cleaned extracted text. `LANCEDB_PATH` stores the vector database.

This is a local, single-user hackathon setup, not an authenticated or production document service. The API binds to loopback and rejects browser origins outside localhost. Treat the local `data/rag` directory as private; deleting it removes uploaded content and the vector database. Text-based PDF extraction is supported, but scanned PDFs need OCR, which is not included. DOCX and TXT page numbers are unavailable unless the extractor provides them.

## Persistent hackathon registrations

Participant records are stored as structured documents in the existing Firebase Firestore `registrations` collection. LanceDB at `LANCEDB_PATH` remains exclusively for RAG vectors and chunk metadata; registration data is never embedded or inserted into that vector collection. A separate `registration_unique_keys` collection stores hashed email/team identifiers. Firestore transactions write the registration and both uniqueness keys atomically.

The registration form sends only its existing fields to `POST /api/registrations`. The server validates them, calculates the confirmed ₹1,000 fee and 10% discount through 20 December 2026 using India local time, and sets payment status to `unpaid`. Amounts sent by a browser are ignored. The confirmation appears only after Firestore commits the record. Email/team duplicates receive a conflict response.

The organiser dashboard sends its Firebase ID token to protected registration-list, detail, and attendance APIs. The backend verifies the token with Firebase Admin and requires either an `admin`/`organizer` custom claim or a verified email in `ORGANIZER_EMAILS`. Participant email and phone details are returned only to an authorized organiser. Payment status stays unpaid because this project does not verify payments.

No separate SQL database or schema migration is needed: the existing Firestore database already stores structured records. To backfill unique-key documents for registrations created by the older website version, run this once after configuring Firebase credentials:

```sh
npm run registrations:migrate
```

The first new registration also checks and indexes legacy Firestore records automatically. Browser-only registrations from an older localStorage-only setup are not automatically uploaded; export and review those records before any manual migration.

## Earlier pipeline stages

`server/preprocessing.js` exposes `preprocessExtractedText(rawText)`, which preserves raw text and returns a separate `cleanedText`. It removes repeated headers and footers only when they can be identified safely.

`server/chunking.js` exposes `chunkCleanedText(cleanedText, options)`. It preserves chunk IDs, sequential indexes, document IDs, source filename, section names, and page ranges where available. Character-based chunk sizing is used because this project does not have a tokenizer.

## Tests and checks

```sh
npm test
npm run test:preprocessing
npm run test:chunking
npm run lint
npm run build
```

Tests use mocked provider/store behavior and do not require live OpenAI or Firebase credentials. To test real document RAG and registration persistence, configure valid `OPENAI_API_KEY`, Firebase Admin credentials, and organiser settings in `.env.local`, then run the local app.
