# User Profile & Photo Upload: Frontend Integration Guide

This guide details how frontend clients (**Web, Mobile React Native, Flutter, and Desktop**) can integrate User Profile management and direct photo/avatar uploads.

---

## 🌟 Overview of Features

1. **Direct Photo/Avatar Upload**: Upload profile pictures directly via `multipart/form-data`. The backend automatically pushes the image to **AWS S3** (`uploads/avatars/`) and updates the user record in one step.
2. **JSON Profile Updates**: Update display name, avatar URL, and collaboration use-cases via standard `application/json`.
3. **Web & Mobile Friendly**: Supports both nested data envelopes (`res.data.user`) and mobile platform headers (`x-client-platform: mobile`).
4. **Session Profile Hydration**: `GET /api/auth/me` and `GET /api/users/profile` return the full profile including `avatar`, `isOnboarded`, and `useCases`.

---

## 🛠️ API Endpoints Summary

| Method | Endpoint | Description | Content-Type | Auth Required |
| :--- | :--- | :--- | :--- | :--- |
| **GET** | `/api/users/profile` | Fetch complete profile for authenticated user | `application/json` | ✅ Bearer / Cookie |
| **PATCH** | `/api/users/profile` | Update profile fields (partial update) | `multipart/form-data` OR `application/json` | ✅ Bearer / Cookie |
| **PUT** | `/api/users/profile` | Set/Replace profile fields | `multipart/form-data` OR `application/json` | ✅ Bearer / Cookie |
| **GET** | `/api/auth/me` | Fetch authenticated user session (includes `avatar`, `isOnboarded`, `useCases`) | `application/json` | ✅ Bearer / Cookie |

*(Endpoints are also accessible at `/api/v1/users/profile` and `/api/user/profile`).*

---

## 📸 1. Direct Avatar Photo Upload (`multipart/form-data`)

Use this when a user chooses an image from their camera or photo library. You can upload the photo and update the user's name or use cases in the same request without needing a separate upload step.

### Supported Image Formats
- `.jpg`, `.jpeg`, `.png`, `.webp`, `.heic`, `.gif`
- **Max File Size**: 10 MB

### Accepted Field Names
- **File field**: `avatar` or `file` or `image`
- **Text fields**: `name`, `useCases`, `isOnboarded`

---

### A. Mobile App (React Native / Expo)
```typescript
import * as ImagePicker from 'expo-image-picker';

export const updateAvatarFromMobile = async (accessToken: string) => {
  // 1. Pick image from device gallery or camera
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1], // Square avatar
    quality: 0.8,
  });

  if (result.canceled) return;

  const asset = result.assets[0];

  // 2. Prepare FormData
  const formData = new FormData();
  formData.append('avatar', {
    uri: asset.uri,
    name: 'avatar.jpg',
    type: 'image/jpeg',
  } as any);

  // Optional: update name or use cases simultaneously
  formData.append('name', 'Alex Mercer');
  formData.append('useCases', JSON.stringify(['COMMUNITY', 'ORGANIZATION']));

  // 3. Send to API
  const response = await fetch('https://api.newquorum.me/api/users/profile', {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'x-client-platform': 'mobile',
    },
    body: formData,
  });

  const json = await response.json();
  console.log('New Avatar URL:', json.user.avatar);
  return json.user;
};
```

---

### B. Web App (React / TypeScript)
```typescript
import React, { useState } from 'react';

export const AvatarUploader: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string>('');

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append('avatar', file);

    try {
      const res = await fetch('/api/users/profile', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
        },
        body: formData,
      });

      const data = await res.json();
      if (res.ok) {
        setAvatarUrl(data.data.user.avatar);
      } else {
        alert(data.message || 'Upload failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <input type="file" accept="image/*" onChange={handleFileChange} disabled={loading} />
      {avatarUrl && <img src={avatarUrl} alt="User Avatar" style={{ width: 80, height: 80, borderRadius: '50%' }} />}
    </div>
  );
};
```

---

## 📝 2. JSON Profile Updates (`application/json`)

Use this when editing profile text fields (like `name` or `useCases`) without re-uploading an image file:

### Request
- **URL**: `PATCH /api/users/profile`
- **Headers**:
  - `Authorization: Bearer <accessToken>`
  - `Content-Type: application/json`
- **Body**:
  ```json
  {
    "name": "Alex Mercer",
    "avatar": "https://quorumuploads.s3.ap-south-1.amazonaws.com/uploads/avatars/avatar.png",
    "useCases": ["COMMUNITY", "ORGANIZATION", "HIRE_COLLABORATE"]
  }
  ```

### Response (`200 OK`)
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Profile updated successfully",
  "data": {
    "user": {
      "id": "5c1cc8b7-7053-4ace-93d0-bb5dd03f37db",
      "name": "Alex Mercer",
      "email": "alex@quorum.me",
      "role": "member",
      "avatar": "https://quorumuploads.s3.ap-south-1.amazonaws.com/uploads/avatars/1793474800332_bb2f9335_profile_avatar.png",
      "isEmailVerified": true,
      "isOnboarded": true,
      "useCases": [
        "COMMUNITY",
        "ORGANIZATION",
        "HIRE_COLLABORATE"
      ],
      "createdAt": "2026-10-31T18:24:59.000Z",
      "updatedAt": "2026-11-01T00:56:40.000Z",
      "lastLogin": "2026-10-31T18:25:00.000Z"
    }
  }
}
```

---

## 🔍 3. Fetching User Profile

### Request
`GET /api/users/profile` (or `GET /api/auth/me`)

Both endpoints return the complete user profile object containing:
- `id` (UUID)
- `name` (string)
- `email` (string)
- `avatar` (string | null - S3 public URL)
- `role` (string)
- `isEmailVerified` (boolean)
- `isOnboarded` (boolean)
- `useCases` (array of `UseCase` enum)
- `createdAt` & `updatedAt` (ISO Date strings)
- `lastLogin` (ISO Date string | null)

---

## 📦 TypeScript Interfaces

```typescript
export type UseCase = 'ORGANIZATION' | 'FREELANCE' | 'HIRE_COLLABORATE' | 'COMMUNITY';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar: string | null;
  isEmailVerified: boolean;
  isOnboarded: boolean;
  useCases: UseCase[];
  createdAt: string;
  updatedAt: string;
  lastLogin?: string | null;
}

export interface UpdateProfileInput {
  name?: string;
  avatar?: string | null;
  useCases?: UseCase[];
  isOnboarded?: boolean;
}
```

---

## ⚠️ Error Codes & Handling

| Status Code | Error Message | Action Required |
| :--- | :--- | :--- |
| `400 Bad Request` | `"Name cannot be empty"` | User must provide at least 1 non-whitespace character for name. |
| `400 Bad Request` | `"File size exceeds allowed limit (10MB)"` | Image file size must be under 10MB. |
| `400 Bad Request` | `"File type is not permitted"` | Upload an image file (`.png`, `.jpg`, `.webp`, `.heic`, `.gif`). |
| `401 Unauthorized` | `"Unauthorized, login required"` | Token missing or expired; refresh token or redirect to login. |
