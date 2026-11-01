# WhatsApp-Grade Push Notifications: Frontend Integration Guide

This guide details how frontend mobile clients (**React Native / Expo, Flutter, iOS Swift, and Android**) and web apps can integrate Quorum's **WhatsApp-grade OS push notifications**.

---

## 🌟 Overview of Notification Features

1. **High-Priority Heads-Up Alerts**:
   - Wakes up locked screens and displays floating heads-up notification banners with sound and vibration.
   - Bypasses Android Doze mode and iOS battery optimizations via high-priority delivery flags.

2. **Conversation Threading & Grouping (Like WhatsApp)**:
   - Multiple messages from the same sender or group chat automatically collapse into a single stacked thread instead of flooding the notification drawer.
   - Powered by Android `tag` / `collapseKey` and iOS `thread-id`.

3. **App Icon Badge Counts**:
   - The backend dynamically calculates unread messages and sends `badge: unreadCount` to update the red badge number on the user's home screen icon.

4. **Lock-Screen Quick Reply (`MESSAGE_REPLY`)**:
   - Users can type and send replies directly from the lock screen or heads-up banner without opening the app.

5. **Smart Background Detection (`client:lifecycle`)**:
   - When the mobile app is minimized or the screen turns off, the client reports its lifecycle state to the backend so push notifications are dispatched immediately (without waiting for WebSocket heartbeat timeout).

---

## 📱 1. Device Token Registration

When the user logs in or launches the app, retrieve the device push token (FCM or APNs) and register it with the backend.

### Endpoints

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :---: |
| **POST** | `/api/devices` | Register device token | ✅ Bearer / Cookie |
| **DELETE**| `/api/devices` | Unregister device token (Call on Logout!) | ✅ Bearer / Cookie |

---

### A. Register Token Payload (`POST /api/devices`)

```json
{
  "token": "eX_8aB9_ExampleFCMTokenFromFirebase...",
  "platform": "android" 
}
```
*(Accepted `platform` values: `"android"`, `"ios"`, `"web"`).*

#### Response (`200 OK`):
```json
{
  "success": true,
  "message": "Device token registered successfully",
  "data": {
    "id": "dev-token-uuid",
    "userId": "user-uuid",
    "token": "eX_8aB9_ExampleFCMTokenFromFirebase...",
    "platform": "android"
  }
}
```

---

### B. Unregister Token Payload on Logout (`DELETE /api/devices`)

> ⚠️ **Important**: Always call this when a user logs out so they stop receiving personal messages on that device.

```json
{
  "token": "eX_8aB9_ExampleFCMTokenFromFirebase..."
}
```

---

## 🔄 2. Client Lifecycle Reporting (`client:lifecycle`)

When the user locks their phone or switches apps, the WebSocket connection might linger for 30–60 seconds before timing out. To ensure push notifications are delivered **instantly** without waiting for socket timeout:

### React Native / Expo Example:
```typescript
import { useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { socket } from './socketClient';

export const useAppLifecycleSync = () => {
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      const state = nextAppState === 'active' ? 'active' : 'background';
      
      if (socket.connected) {
        // Notify backend that user minimized or resumed app
        socket.emit('client:lifecycle', { state });
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);
};
```

### Flutter Example:
```dart
class LifecycleWatcher extends StatefulWidget {
  @override
  _LifecycleWatcherState createState() => _LifecycleWatcherState();
}

class _LifecycleWatcherState extends State<LifecycleWatcher> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final status = (state == AppLifecycleState.resumed) ? 'active' : 'background';
    socket.emit('client:lifecycle', {'state': status});
  }
}
```

---

## 🤖 3. Android Configuration (Heads-Up Banner & Channel)

Android 8.0+ requires a **Notification Channel** with `Importance.Max` (or `Importance.High`) for notifications to pop up over running apps as heads-up banners with sound.

### Android Notification Channel Setup
The backend dispatches chat messages under `channelId: 'quorum_chat_messages'`. Make sure your mobile app creates this channel at startup.

#### React Native / `@notifee/react-native` Example:
```typescript
import notifee, { AndroidImportance } from '@notifee/react-native';

export const setupAndroidChannels = async () => {
  await notifee.createChannel({
    id: 'quorum_chat_messages',
    name: 'Quorum Chat Messages',
    description: 'Direct messages, mentions, and community alerts',
    importance: AndroidImportance.HIGH,
    sound: 'default',
    vibration: true,
  });
};
```

#### Android Native (Kotlin) Example:
```kotlin
if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
    val channel = NotificationChannel(
        "quorum_chat_messages",
        "Quorum Chat Messages",
        NotificationManager.IMPORTANCE_HIGH
    ).apply {
        description = "Direct messages and mentions"
        enableLights(true)
        enableVibration(true)
    }
    val notificationManager = getSystemService(NotificationManager::class.java)
    notificationManager.createNotificationChannel(channel)
}
```

---

## 🍏 4. iOS Configuration (Interactive Quick Reply & Badging)

The backend sends APNs payloads with:
- `category: 'MESSAGE_REPLY'`
- `'thread-id': conversationId`
- `badge: count`
- `'mutable-content': 1`

### A. Register the `MESSAGE_REPLY` Category
Register the category during app initialization so iOS renders an inline **"Reply"** text input directly on the lock screen.

#### React Native (`@notifee/react-native`) Example:
```typescript
import notifee from '@notifee/react-native';

export const setupIOSCategories = async () => {
  await notifee.setNotificationCategories([
    {
      id: 'MESSAGE_REPLY',
      actions: [
        {
          id: 'reply',
          title: 'Reply',
          input: {
            placeholderText: 'Type your reply...',
            buttonText: 'Send',
          },
        },
        {
          id: 'mark_as_read',
          title: 'Mark as Read',
        },
      ],
    },
  ]);
};
```

#### Swift (iOS Native) Example:
```swift
let replyAction = UNTextInputNotificationAction(
    identifier: "reply",
    title: "Reply",
    options: [],
    textInputButtonTitle: "Send",
    textInputPlaceholder: "Type your reply..."
)

let markReadAction = UNNotificationAction(
    identifier: "mark_as_read",
    title: "Mark as Read",
    options: []
)

let chatCategory = UNNotificationCategory(
    identifier: "MESSAGE_REPLY",
    actions: [replyAction, markReadAction],
    intentIdentifiers: [],
    options: .customDismissAction
)

UNUserNotificationCenter.current().setNotificationCategories([chatCategory])
```

---

## 📦 5. Incoming Push Payload Shape

When a push arrives, the OS notification service will receive the following payload structure:

```json
{
  "notification": {
    "title": "Alice Johnson",
    "body": "Can you check the latest designs?"
  },
  "data": {
    "conversationId": "7a353603-51b6-455b-9d41-e9ff6b3e6962",
    "messageId": "9b1244e8-8a21-4f11-9252-c3f253e97f90",
    "type": "CHAT_MESSAGE"
  },
  "android": {
    "priority": "high",
    "notification": {
      "channelId": "quorum_chat_messages",
      "tag": "7a353603-51b6-455b-9d41-e9ff6b3e6962",
      "sound": "default",
      "priority": "max",
      "notificationCount": 3
    }
  },
  "apns": {
    "payload": {
      "aps": {
        "alert": {
          "title": "Alice Johnson",
          "body": "Can you check the latest designs?"
        },
        "sound": "default",
        "badge": 3,
        "thread-id": "7a353603-51b6-455b-9d41-e9ff6b3e6962",
        "category": "MESSAGE_REPLY"
      }
    }
  }
}
```

---

## 🧭 6. Handling Notification Click / Navigation

When the user taps the notification banner:

```typescript
import messaging from '@react-native-firebase/messaging';

// 1. App in Background or Quit state
messaging().onNotificationOpenedApp((remoteMessage) => {
  const conversationId = remoteMessage.data?.conversationId;
  if (conversationId) {
    navigation.navigate('ChatScreen', { conversationId });
  }
});

// 2. Cold Start (App was completely closed)
messaging()
  .getInitialNotification()
  .then((remoteMessage) => {
    if (remoteMessage?.data?.conversationId) {
      navigation.navigate('ChatScreen', {
        conversationId: remoteMessage.data.conversationId,
      });
    }
  });
```

---

## ✅ 7. Frontend Integration Checklist

- [ ] **Device Registration**: Call `POST /api/devices` after user authentication with valid push token.
- [ ] **Logout Cleanup**: Call `DELETE /api/devices` on logout.
- [ ] **Android Channel**: Initialize `quorum_chat_messages` channel with `Importance.High`.
- [ ] **iOS Category**: Register `MESSAGE_REPLY` category for inline replies.
- [ ] **Lifecycle Sync**: Emit `client:lifecycle` with `'active'` or `'background'` on app state transitions.
- [ ] **Tap-to-Open**: Navigate directly to the corresponding `conversationId` when user clicks notification.
