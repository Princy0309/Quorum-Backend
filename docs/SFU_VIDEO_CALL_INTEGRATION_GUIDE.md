# Quorum SFU Video & Audio Calling — Frontend & Mobile Integration Guide

This guide provides end-to-end instructions and code examples for frontend developers integrating the **Quorum SFU Video Call Feature** into both **Web** (React, Next.js, Vue) and **Mobile Apps** (React Native, Flutter, iOS/Android).

---

## 1. How Quorum SFU Architecture Works

Quorum uses a **Selective Forwarding Unit (SFU)** model:
- **Publishing (Uplink)**: Each user creates **one** `publisherPc` that sends their camera and microphone stream to the Quorum backend.
- **Subscribing (Downlink)**: When other participants publish tracks, the server emits `sfu:new-producer`. The client creates a `consumerPc` for each remote track, calls `sfu:subscribe`, and renders the incoming audio/video via an HTML `<video>` element or native `RTCVideoView`.
- **Signaling**: Handled in real time over Socket.IO.

```
       [ Client A (You) ]                                 [ Quorum Backend (SFU) ]                                 [ Client B ]
               │                                                      │                                                  │
               │────── sfu:join { roomCode, peerId } ────────────────>│                                                  │
               │<───── sfu:joined { existingTracks } ─────────────────│                                                  │
               │                                                      │────── sfu:peer-joined { peerId, name } ─────────>│
               │                                                      │                                                  │
               │── 1. Create publisherPc (sendonly/sendrecv) ─────────│                                                  │
               │────── sfu:offer { sdp } ─────────────────────────────>│                                                  │
               │<───── sfu:answer { sdp } ────────────────────────────│                                                  │
               │                                                      │────── sfu:new-producer { peerId, trackId } ─────>│
               │                                                      │                                                  │
               │                                                      │<───── sfu:subscribe { trackId, sdp } ────────────│
               │                                                      │────── sfu:subscribed { trackId, sdp } ──────────>│
               │────── [ Real-time RTP Media Stream ] ───────────────>│────── [ Real-time RTP Media Stream ] ───────────>│
```

---

## 2. Web Integration (React / Next.js / TypeScript)

### 2.1 Dependencies
```bash
npm install socket.io-client
```

### 2.2 Reusable SFU Client Service (`sfuClient.ts`)

```typescript
import { io, Socket } from 'socket.io-client';

export interface RemoteTrackEvent {
  peerId: string;
  trackId: string;
  kind: 'audio' | 'video';
  stream: MediaStream;
}

export class QuorumSFUClient {
  private socket: Socket;
  private publisherPc: RTCPeerConnection | null = null;
  private consumerPcs = new Map<string, RTCPeerConnection>(); // trackId -> RTCPeerConnection
  private remoteStreams = new Map<string, MediaStream>(); // peerId -> MediaStream
  private roomCode: string = '';
  private myPeerId: string = '';

  public onRemoteTrackAdded?: (event: RemoteTrackEvent) => void;
  public onRemotePeerLeft?: (peerId: string) => void;

  constructor(backendUrl: string) {
    this.socket = io(backendUrl, {
      transports: ['websocket', 'polling'],
      withCredentials: true, // Sends auth cookies
    });

    this.setupSignalingListeners();
  }

  // 1. Join Room and Start Publishing Local Webcam & Mic
  public async joinAndPublish(roomCode: string, peerId: string, localStream: MediaStream) {
    this.roomCode = roomCode;
    this.myPeerId = peerId;

    // Join SFU Room
    this.socket.emit('sfu:join', { roomCode, peerId });

    // Initialize Publisher PeerConnection
    this.publisherPc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    // Add local audio and video tracks
    localStream.getTracks().forEach((track) => {
      this.publisherPc!.addTrack(track, localStream);
    });

    // Send local ICE candidates to backend
    this.publisherPc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('sfu:ice-candidate', {
          roomCode: this.roomCode,
          peerId: this.myPeerId,
          candidate: event.candidate,
          target: 'publisher',
        });
      }
    };

    // Create & Send SDP Offer
    const offer = await this.publisherPc.createOffer();
    await this.publisherPc.setLocalDescription(offer);

    this.socket.emit('sfu:offer', {
      roomCode: this.roomCode,
      peerId: this.myPeerId,
      sdp: { type: offer.type, sdp: offer.sdp },
    });
  }

  // 2. Setup Signaling Listeners
  private setupSignalingListeners() {
    // Server returns SDP answer for publisher
    this.socket.on('sfu:answer', async ({ sdp }) => {
      if (this.publisherPc) {
        await this.publisherPc.setRemoteDescription(new RTCSessionDescription(sdp));
      }
    });

    // Server announces existing tracks on join
    this.socket.on('sfu:joined', ({ existingTracks }) => {
      existingTracks.forEach((t: { peerId: string; trackId: string }) => {
        if (t.peerId !== this.myPeerId) {
          this.subscribeToTrack(t.trackId, t.peerId);
        }
      });
    });

    // Server announces new participant publishing a track
    this.socket.on('sfu:new-producer', ({ peerId, trackId }) => {
      if (peerId !== this.myPeerId) {
        this.subscribeToTrack(trackId, peerId);
      }
    });

    // Server returns SDP answer for subscriber track
    this.socket.on('sfu:subscribed', async ({ trackId, sdp }) => {
      const pc = this.consumerPcs.get(trackId);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      }
    });

    // Participant unpublished track
    this.socket.on('sfu:track-unpublished', ({ trackId }) => {
      const pc = this.consumerPcs.get(trackId);
      if (pc) {
        pc.close();
        this.consumerPcs.delete(trackId);
      }
    });

    // Participant left the room
    this.socket.on('sfu:peer-left', ({ peerId }) => {
      this.remoteStreams.delete(peerId);
      this.onRemotePeerLeft?.(peerId);
    });
  }

  // 3. Subscribe to a remote participant's track
  private async subscribeToTrack(trackId: string, peerId: string) {
    if (this.consumerPcs.has(trackId)) return;

    const consumerPc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    this.consumerPcs.set(trackId, consumerPc);

    // Prepare receiving transceiver (recvonly)
    consumerPc.addTransceiver('video', { direction: 'recvonly' });
    consumerPc.addTransceiver('audio', { direction: 'recvonly' });

    // Handle incoming media stream
    consumerPc.ontrack = (event) => {
      let stream = this.remoteStreams.get(peerId);
      if (!stream) {
        stream = new MediaStream();
        this.remoteStreams.set(peerId, stream);
      }
      stream.addTrack(event.track);

      // Trigger UI callback
      this.onRemoteTrackAdded?.({
        peerId,
        trackId,
        kind: event.track.kind as 'audio' | 'video',
        stream,
      });

      // Request immediate keyframe to avoid initial video lag
      if (event.track.kind === 'video') {
        this.socket.emit('sfu:request-keyframe', {
          roomCode: this.roomCode,
          publisherPeerId: peerId,
          trackId,
        });
      }
    };

    // Forward subscriber ICE candidates to backend
    consumerPc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('sfu:subscribe-ice-candidate', {
          roomCode: this.roomCode,
          peerId: this.myPeerId,
          trackId,
          candidate: event.candidate,
        });
      }
    };

    // Create & Send subscribe SDP offer
    const offer = await consumerPc.createOffer();
    await consumerPc.setLocalDescription(offer);

    this.socket.emit('sfu:subscribe', {
      roomCode: this.roomCode,
      subscriberPeerId: this.myPeerId,
      trackId,
      sdp: { type: offer.type, sdp: offer.sdp },
    });
  }

  // 4. Leave Call and Cleanup
  public leave() {
    this.socket.emit('sfu:leave', { roomCode: this.roomCode });
    this.publisherPc?.close();
    this.consumerPcs.forEach((pc) => pc.close());
    this.consumerPcs.clear();
    this.remoteStreams.clear();
    this.socket.disconnect();
  }
}
```

### 2.3 React Component Example (`VideoCallScreen.tsx`)

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { QuorumSFUClient, RemoteTrackEvent } from './sfuClient';

export const VideoCallScreen = ({ roomCode, userId }: { roomCode: string; userId: string }) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const sfuClientRef = useRef<QuorumSFUClient | null>(null);

  useEffect(() => {
    let localStream: MediaStream;

    async function start() {
      // 1. Acquire Webcam & Microphone
      localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true,
      });

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
      }

      // 2. Initialize SFU Client
      const client = new QuorumSFUClient(process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000');
      sfuClientRef.current = client;

      // Handle new remote video/audio streams
      client.onRemoteTrackAdded = ({ peerId, stream }: RemoteTrackEvent) => {
        setRemoteStreams((prev) => new Map(prev.set(peerId, stream)));
      };

      // Handle participant disconnect
      client.onRemotePeerLeft = (peerId: string) => {
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          next.delete(peerId);
          return next;
        });
      };

      // Join room
      await client.joinAndPublish(roomCode, userId, localStream);
    }

    start();

    return () => {
      localStream?.getTracks().forEach((t) => t.stop());
      sfuClientRef.current?.leave();
    };
  }, [roomCode, userId]);

  return (
    <div className="grid grid-cols-2 gap-4 p-4 bg-slate-900 min-h-screen">
      {/* Local Video Card */}
      <div className="relative rounded-xl overflow-hidden bg-black aspect-video border border-blue-500">
        <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        <span className="absolute bottom-2 left-2 bg-black/70 px-2 py-1 text-xs text-white rounded">
          You ({userId})
        </span>
      </div>

      {/* Remote Video Cards */}
      {Array.from(remoteStreams.entries()).map(([peerId, stream]) => (
        <div key={peerId} className="relative rounded-xl overflow-hidden bg-black aspect-video border border-slate-700">
          <video
            autoPlay
            playsInline
            ref={(videoEl) => {
              if (videoEl && videoEl.srcObject !== stream) {
                videoEl.srcObject = stream;
              }
            }}
            className="w-full h-full object-cover"
          />
          <span className="absolute bottom-2 left-2 bg-black/70 px-2 py-1 text-xs text-white rounded">
            Participant {peerId}
          </span>
        </div>
      ))}
    </div>
  );
};
```

---

## 3. Mobile App Integration

### 3.1 React Native (`react-native-webrtc`)

#### Installation:
```bash
npm install react-native-webrtc socket.io-client
```

#### Android Permissions (`android/app/src/main/AndroidManifest.xml`):
```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
```

#### iOS Permissions (`ios/Runner/Info.plist`):
```xml
<key>NSCameraUsageDescription</key>
<string>Quorum needs camera access for video meetings</string>
<key>NSMicrophoneUsageDescription</key>
<string>Quorum needs microphone access for video meetings</string>
```

#### React Native Component Snippet:
```tsx
import { RTCPeerConnection, RTCView, mediaDevices } from 'react-native-webrtc';
import { io } from 'socket.io-client';

// 1. Get User Media in React Native
const stream = await mediaDevices.getUserMedia({
  audio: true,
  video: {
    facingMode: 'user',
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
});

// 2. Render Video in React Native View:
<RTCView
  streamURL={stream.toURL()}
  style={{ width: '100%', height: 300 }}
  objectFit="cover"
  mirror={true}
/>
```
*(The signaling logic and `QuorumSFUClient` above work identically in React Native! Simply replace standard browser `RTCPeerConnection` with the import from `react-native-webrtc`).*

---

### 3.2 Flutter (`flutter_webrtc`)

#### Installation (`pubspec.yaml`):
```yaml
dependencies:
  flutter_webrtc: ^0.11.7
  socket_io_client: ^3.0.2
```

#### Flutter Usage Snippet:
```dart
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;

// 1. Initialize Renderer
final RTCVideoRenderer _localRenderer = RTCVideoRenderer();
await _localRenderer.initialize();

// 2. Acquire Camera & Microphone
final Map<String, dynamic> mediaConstraints = {
  'audio': true,
  'video': {
    'facingMode': 'user',
    'width': 1280,
    'height': 720,
  }
};
MediaStream stream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
_localRenderer.srcObject = stream;

// 3. Render in Widget Tree:
RTCVideoView(_localRenderer, mirror: true)
```

---

## 4. Complete Socket.IO Event Reference

### 📤 Client → Server (Emit)

| Event | Payload | Description |
|---|---|---|
| `sfu:join` | `{ roomCode: string, peerId: string, name?: string }` | Joins the SFU meeting room and triggers producer discovery. |
| `sfu:offer` | `{ roomCode: string, peerId: string, sdp: { type: 'offer', sdp: string } }` | Sends publisher SDP offer containing client's webcam & mic tracks. |
| `sfu:ice-candidate` | `{ roomCode: string, peerId: string, candidate: any, target?: 'publisher' }` | Sends ICE candidate for the publisher connection. |
| `sfu:subscribe` | `{ roomCode: string, subscriberPeerId: string, trackId: string, sdp: { type: 'offer', sdp: string } }` | Requests subscription to a specific remote track. |
| `sfu:subscribe-ice-candidate` | `{ roomCode: string, peerId: string, trackId: string, candidate: any }` | Sends ICE candidate for a specific consumer track connection. |
| `sfu:request-keyframe` | `{ roomCode: string, publisherPeerId: string, trackId?: string }` | Sends a PLI (Picture Loss Indication) to immediately refresh video frames. |
| `sfu:leave` | `{ roomCode: string }` | Gracefully closes all room peer connections and notifies other peers. |

---

### 📥 Server → Client (Listen)

| Event | Payload | Description |
|---|---|---|
| `sfu:joined` | `{ existingTracks: Array<{ trackId, kind, peerId }> }` | Returned immediately upon join with all tracks already in the room. |
| `sfu:peer-joined` | `{ peerId: string, name: string }` | Emitted to room members when a new peer enters. |
| `sfu:new-producer` | `{ peerId: string, trackId: string, kind: 'audio' \| 'video' }` | Emitted when any participant begins publishing a track. |
| `sfu:answer` | `{ sdp: { type: 'answer', sdp: string } }` | Returned by SFU in response to `sfu:offer`. |
| `sfu:subscribed` | `{ trackId: string, sdp: { type: 'answer', sdp: string } }` | Returned by SFU in response to `sfu:subscribe`. |
| `sfu:track-unpublished` | `{ peerId: string, trackId: string }` | Emitted when a user mutes or unpublishes a track. |
| `sfu:peer-left` | `{ peerId: string }` | Emitted when a peer disconnects or leaves the meeting. |
| `sfu:error` | `{ message: string }` | Emitted when authorization fails or invalid parameters are provided. |

---

## 5. Production Best Practices & Gotchas

1. **Local Video Must Be Muted (`muted={true}`)**:
   Always set `muted` on the local `<video>` element. If not muted, the user will hear their own microphone feedback loop with a 50ms delay.
2. **Handle Browser Autoplay Policy**:
   Browsers often block unmuted audio from auto-playing without user interaction. Provide an explicit **"Click to Unmute"** button or start call via a click event.
3. **STUN Configuration**:
   Use public Google STUN:
   ```javascript
   { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
   ```
4. **Clean Disconnection on Unmount**:
   Always stop local media tracks when leaving the component:
   ```javascript
   localStream.getTracks().forEach(track => track.stop());
   ```
   This immediately turns off the hardware webcam light on the user's laptop/phone.
