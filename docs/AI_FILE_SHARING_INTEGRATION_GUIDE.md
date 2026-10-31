# Quorum AI File Sharing & Document Analysis: Frontend Integration Guide

This guide details how frontend clients (Web, Mobile, Desktop) can integrate file sharing and document analysis into the Quorum AI Assistant.

---

## 🌟 Feature Overview

Users can now share documents, images, spreadsheets, and code files directly with Quorum AI to:
- 📊 **Summarize documents** (PDFs, Markdown notes, text documents).
- 🖼️ **Analyze images** (screenshots, wireframes, charts, UI diagrams, error logs).
- 📈 **Extract insights from data** (CSV spreadsheets, JSON exports, sprint reports).
- ❓ **Ask questions about attachments** (e.g., *"What are the key deliverables in this sprint agenda?"*).
- 💡 **File-only queries**: Users can upload a file without typing a prompt; the AI defaults to reviewing and summarizing the file.

---

## 🚀 Integration Methods

The backend supports three convenient integration methods:

| Method | Best For | Endpoint | Content-Type |
| :--- | :--- | :--- | :--- |
| **1. Direct Multipart** | Instant attachments in chat (single or multiple files) | `POST /api/ai/chat` | `multipart/form-data` |
| **2. S3 Presigned URL** | Large files or when showing an upload progress bar before sending | `POST /api/ai/upload` then `POST /api/ai/chat` | `application/json` |
| **3. Base64 JSON** | Client-cached files, code snippets, or small documents | `POST /api/ai/chat` | `application/json` |

---

## 📁 Supported File Formats

| Category | File Extensions | Processing Method |
| :--- | :--- | :--- |
| **Images** | `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` | Native Gemini Multimodal Vision (`inlineData`) |
| **PDF Documents** | `.pdf` | Native Gemini Document Parsing (`inlineData`) |
| **Spreadsheets & Data** | `.csv`, `.tsv`, `.json`, `.xml` | Context Document Parsing (`<attached_document>`) |
| **Text & Notes** | `.txt`, `.md`, `.markdown`, `.rtf` | Context Document Parsing (`<attached_document>`) |
| **Code & Configs** | `.js`, `.ts`, `.html`, `.css`, `.py`, `.sql`, `.yaml`, `.yml` | Context Document Parsing (`<attached_document>`) |

> **Size Limit**: Up to 10 MB per file, max 5 attachments per prompt.

---

## 🛠️ API Reference

### 1. Direct File Upload in Chat (`multipart/form-data`)

Send a `FormData` object directly to `POST /api/ai/chat`.

#### Request
- **URL**: `POST /api/ai/chat`
- **Headers**:
  - `Authorization: Bearer <accessToken>` (or authenticated via browser cookies)
  - `Content-Type: multipart/form-data` (browser will automatically set boundary)
- **Form Fields**:
  - `prompt` *(optional if file attached)*: User's question or instruction.
  - `context` *(optional)*: Passive context string (e.g. current channel, meeting notes).
  - `file` or `files` *(optional if prompt provided)*: The attached file(s) (Blob / File object).

#### Example: JavaScript / React
```typescript
const formData = new FormData();
formData.append('prompt', 'Please summarize the action items in this meeting notes file.');
formData.append('file', fileInput.files[0]); // or multiple files via 'files'

const response = await fetch('/api/ai/chat', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
  },
  body: formData,
});

const result = await response.json();
console.log(result.data.answer);
```

---

### 2. S3 Presigned Upload + JSON Chat (`application/json`)

Use this workflow for large files to show an upload progress bar to the user before submitting the AI query.

#### Step 1: Request S3 Presigned Upload URL
- **URL**: `POST /api/ai/upload`
- **Headers**:
  - `Authorization: Bearer <accessToken>`
  - `Content-Type: application/json`
- **Body**:
  ```json
  {
    "fileName": "sprint_deliverables.pdf",
    "fileSize": 204800,
    "mimeType": "application/pdf"
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "statusCode": 200,
    "message": "S3 presigned upload URL generated for AI file sharing",
    "data": {
      "uploadUrl": "https://quorumuploads.s3.amazonaws.com/uploads/ai/1730379200000-sprint_deliverables.pdf?AWSAccessKeyId=...",
      "fileUrl": "https://quorumuploads.s3.amazonaws.com/uploads/ai/1730379200000-sprint_deliverables.pdf",
      "key": "uploads/ai/1730379200000-sprint_deliverables.pdf",
      "storageProvider": "s3"
    }
  }
  ```

#### Step 2: Upload File to S3
Upload the raw file directly to `data.uploadUrl` using `PUT`:
```typescript
await axios.put(data.uploadUrl, fileBlob, {
  headers: {
    'Content-Type': fileBlob.type || 'application/octet-stream',
  },
  onUploadProgress: (progressEvent) => {
    const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
    setUploadProgress(percentCompleted);
  },
});
```

#### Step 3: Send Chat Message with `fileUrl`
- **URL**: `POST /api/ai/chat`
- **Headers**:
  - `Authorization: Bearer <accessToken>`
  - `Content-Type: application/json`
- **Body**:
  ```json
  {
    "prompt": "What are the key deadlines in this PDF?",
    "fileUrl": "https://quorumuploads.s3.amazonaws.com/uploads/ai/1730379200000-sprint_deliverables.pdf",
    "fileName": "sprint_deliverables.pdf",
    "fileType": "application/pdf"
  }
  ```

---

### 3. Multiple Attachments in JSON (`attachments` array)

To share multiple files in a single chat interaction:

```json
{
  "prompt": "Compare these two quarterly reports and summarize the variance.",
  "attachments": [
    {
      "fileUrl": "https://quorumuploads.s3.amazonaws.com/uploads/ai/q1_report.csv",
      "fileName": "q1_report.csv",
      "fileType": "text/csv"
    },
    {
      "fileUrl": "https://quorumuploads.s3.amazonaws.com/uploads/ai/q2_report.csv",
      "fileName": "q2_report.csv",
      "fileType": "text/csv"
    }
  ]
}
```

---

### 4. Base64 Attachment in JSON

Ideal for small files, text snippets, or clipboard paste images:

```json
{
  "prompt": "Explain what this diagram illustrates.",
  "fileName": "architecture.png",
  "mimeType": "image/png",
  "base64Data": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA..."
}
```

---

## 📥 AI Response Format

Successful responses (`200 OK`) return the standard Quorum envelope with AI metadata and processed attachment details:

```json
{
  "statusCode": 200,
  "message": "AI response generated successfully",
  "data": {
    "answer": "Based on the attached sprint agenda, the team's primary goals are completing the Swagger documentation, implementing AI file sharing, and running integration tests.",
    "metadata": {
      "requestId": "gen-ai-req-1730379201",
      "model": "gemini-2.5-flash",
      "createdAt": "2026-10-31T12:53:21.000Z",
      "tokenUsage": {
        "promptTokenCount": 284,
        "candidatesTokenCount": 58,
        "totalTokenCount": 342
      },
      "attachmentsProcessed": 1
    },
    "attachments": [
      {
        "fileName": "sprint_agenda.md",
        "fileType": "text/markdown",
        "fileSize": 104
      }
    ]
  }
}
```

---

## 🎨 Recommended UI / UX Patterns

1. **Attachment Preview Chip**:
   - Display a preview badge below the chat input before sending (e.g. `📄 sprint_agenda.md (104 KB) ✕`).
   - Allow users to click the `✕` to remove before sending.

2. **File Drag & Drop**:
   - Support dropping files directly onto the AI Chat box.
   - Support pasting images from clipboard (`navigator.clipboard.read()`).

3. **Empty Prompt Fallback**:
   - When a user uploads a file and presses Send without typing a prompt, do **not** block submission.
   - The backend automatically applies an intelligent default prompt: *"Please review, analyze, and explain this attachment in the context of our team collaboration."*

4. **Loading State**:
   - Multimodal and document analysis may take **1.0s – 2.5s** depending on document length. Display a typing/analyzing indicator: *"AI is reading your document..."*.

---

## ⚠️ Error Handling & Troubleshooting

| Status Code | Message / Error | Resolution |
| :--- | :--- | :--- |
| `400 Bad Request` | `"Either prompt or at least one file attachment must be provided."` | Ensure the user typed a prompt OR attached at least one valid file. |
| `401 Unauthorized` | `"Invalid or expired token"` | Refresh access token or redirect to login. |
| `413 Payload Too Large` | `"File size exceeds limit"` | Ensure uploaded file is under 10 MB. |
| `429 Too Many Requests` | `"AI rate limit exceeded"` | User has exceeded the chat rate limit; show cooldown timer. |
